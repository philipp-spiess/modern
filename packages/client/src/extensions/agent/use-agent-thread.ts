import type {
  AgentThreadAbortResult,
  AgentThreadDeliveryMode,
  AgentThreadSendResult,
  AgentThreadViewState,
  AgentThreadWatchUpdate,
} from "@diffs-io/server/src/extensions/agent/types";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
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

    setState(incomingUpdate.state);
    setSeq(incomingUpdate.seq);
    setLastEvent(incomingUpdate.kind === "event" ? incomingUpdate.event : null);
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
      setState(result.state);
      return result;
    },
    [sendMutation],
  );

  const abort = useCallback(async () => {
    const result = await abortMutation.mutateAsync();
    setState(result.state);
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
