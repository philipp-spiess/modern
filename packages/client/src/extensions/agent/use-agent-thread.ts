import type {
  AgentThreadAbortResult,
  AgentThreadDeliveryMode,
  AgentThreadMetaState,
  AgentThreadSendResult,
  AgentThreadStreamMessage,
  AgentThreadViewState,
  AgentThreadWatchUpdate,
} from "@diffs-io/server/src/extensions/agent/types";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { queryClient } from "../../lib/query-client";
import { client, orpc } from "../../lib/rpc";

type AgentThreadEvent = Extract<AgentThreadWatchUpdate, { kind: "event" }>["event"];

export interface UseAgentThreadResult {
  state: AgentThreadViewState | null;
  seq: number;
  lastEvent: AgentThreadEvent | null;
  isLoading: boolean;
  isSending: boolean;
  isAborting: boolean;
  error: Error | null;
  send: (text: string, delivery?: AgentThreadDeliveryMode) => Promise<AgentThreadSendResult>;
  abort: () => Promise<AgentThreadAbortResult>;
}

export function useAgentThread(threadPath?: string): UseAgentThreadResult {
  const [state, setState] = useState<AgentThreadViewState | null>(null);
  const [seq, setSeq] = useState(0);
  const [lastEvent, setLastEvent] = useState<AgentThreadEvent | null>(null);

  const watchQuery = useQuery({
    ...orpc.agent.threadWatch.experimental_liveOptions({
      input: { threadPath: threadPath ?? "" },
      context: { cache: true },
      retry: true,
    }),
    queryKey: ["agent", "thread", "watch", threadPath],
    enabled: Boolean(threadPath),
  });

  const incomingUpdate = watchQuery.data as AgentThreadWatchUpdate | undefined;

  useEffect(() => {
    if (!threadPath) {
      setState(null);
      setSeq(0);
      setLastEvent(null);
    }
  }, [threadPath]);

  useEffect(() => {
    if (!incomingUpdate) {
      return;
    }

    if (incomingUpdate.kind === "snapshot") {
      setState(incomingUpdate.state);
      setLastEvent(null);
    } else {
      setState((current) => {
        if (!current) {
          return current;
        }

        return applyThreadMetaState(applyThreadEvent(current, incomingUpdate.event), incomingUpdate.meta);
      });
      setLastEvent(incomingUpdate.event);
    }

    setSeq(incomingUpdate.seq);
  }, [incomingUpdate]);

  const sendMutation = useMutation({
    mutationFn: async ({ text, delivery }: { text: string; delivery?: AgentThreadDeliveryMode }) => {
      if (!threadPath) {
        throw new Error("Cannot send a message without a thread path.");
      }

      return client.agent.threadSend({
        threadPath,
        text,
        delivery,
      });
    },
  });

  const abortMutation = useMutation({
    mutationFn: async () => {
      if (!threadPath) {
        throw new Error("Cannot abort without a thread path.");
      }

      return client.agent.threadAbort({
        threadPath,
      });
    },
  });

  const send = useCallback(
    async (text: string, delivery: AgentThreadDeliveryMode = "auto") => {
      const result = await sendMutation.mutateAsync({ text, delivery });
      setState((current) => (current ? applyThreadMetaState(current, result.meta) : current));
      void queryClient.invalidateQueries({ queryKey: ["agent", "threadsList"] });
      return result;
    },
    [sendMutation],
  );

  const abort = useCallback(async () => {
    const result = await abortMutation.mutateAsync();
    setState((current) => (current ? applyThreadMetaState(current, result.meta) : current));
    return result;
  }, [abortMutation]);

  const error = (watchQuery.error ?? sendMutation.error ?? abortMutation.error ?? null) as Error | null;

  return {
    state,
    seq,
    lastEvent,
    isLoading: watchQuery.isPending && state === null,
    isSending: sendMutation.isPending,
    isAborting: abortMutation.isPending,
    error,
    send,
    abort,
  };
}

function applyThreadMetaState(state: AgentThreadViewState, meta: AgentThreadMetaState): AgentThreadViewState {
  return {
    ...state,
    ...meta,
  };
}

function applyThreadEvent(state: AgentThreadViewState, event: AgentThreadEvent): AgentThreadViewState {
  switch (event.type) {
    case "message_start": {
      if (event.message.role !== "assistant") {
        return state;
      }

      return {
        ...state,
        streamMessage: event.message as AgentThreadStreamMessage,
      };
    }

    case "message_update": {
      if (event.message.role !== "assistant") {
        return state;
      }

      return {
        ...state,
        streamMessage: event.message as AgentThreadStreamMessage,
      };
    }

    case "message_end": {
      return {
        ...state,
        messages: [...state.messages, event.message],
        streamMessage: event.message.role === "assistant" ? null : state.streamMessage,
      };
    }

    case "turn_end": {
      return appendMissingMessages(state, [event.message, ...event.toolResults]);
    }

    case "agent_end": {
      const withClearedStream =
        state.streamMessage === null
          ? state
          : {
              ...state,
              streamMessage: null,
            };

      if (event.messages.length === 0) {
        return withClearedStream;
      }

      return appendMissingMessages(withClearedStream, event.messages);
    }

    default:
      return state;
  }
}

function appendMissingMessages(
  state: AgentThreadViewState,
  incoming: AgentThreadViewState["messages"],
): AgentThreadViewState {
  const seen = new Set(state.messages.map(getMessageKey));
  const missing = incoming.filter((message) => !seen.has(getMessageKey(message)));

  if (missing.length === 0) {
    return state;
  }

  return {
    ...state,
    messages: [...state.messages, ...missing],
  };
}

function getMessageKey(message: AgentThreadViewState["messages"][number]): string {
  if (message.role === "toolResult") {
    return `${message.role}:${message.timestamp}:${message.toolCallId}`;
  }

  if (message.role === "assistant") {
    return `${message.role}:${message.timestamp}:${message.stopReason}:${message.model}`;
  }

  if (message.role === "custom") {
    return `${message.role}:${message.timestamp}:${message.customType}`;
  }

  if (message.role === "bashExecution") {
    return `${message.role}:${message.timestamp}:${message.command}`;
  }

  return `${message.role}:${message.timestamp}`;
}
