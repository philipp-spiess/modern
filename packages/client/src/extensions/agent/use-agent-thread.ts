import type {
  AgentThreadAbortResult,
  AgentThreadDeliveryMode,
  AgentThreadMessageTail,
  AgentThreadMetaState,
  AgentThreadSendResult,
  AgentThreadStreamMessage,
  AgentThreadViewState,
  AgentThreadWatchUpdate,
} from "@moderndev/server/src/extensions/agent/types";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { queryClient } from "../../lib/query-client";
import { client } from "../../lib/rpc";

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
  applyMeta: (meta: AgentThreadMetaState) => void;
}

export function useAgentThread(threadPath?: string): UseAgentThreadResult {
  const [state, setState] = useState<AgentThreadViewState | null>(null);
  const [seq, setSeq] = useState(0);
  const [lastEvent, setLastEvent] = useState<AgentThreadEvent | null>(null);
  const [watchError, setWatchError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Mutable ref that holds the latest state. The async iterator loop reads
  // and writes through this ref so every event is applied sequentially
  // against the true latest state — no React batching can drop events.
  const stateRef = useRef<AgentThreadViewState | null>(null);

  useEffect(() => {
    if (!threadPath) {
      stateRef.current = null;
      setState(null);
      setSeq(0);
      setLastEvent(null);
      setWatchError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setWatchError(null);

    const run = async () => {
      try {
        const iterator = await client.agent.threadWatch({ threadPath });

        // consumeEventIterator is overkill — just iterate directly.
        // The `client.agent.threadWatch` call returns an async iterator.
        for await (const update of iterator) {
          if (cancelled) break;

          const typed = update as AgentThreadWatchUpdate;
          processUpdate(typed, stateRef, setState, setSeq, setLastEvent);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setWatchError(err instanceof Error ? err : new Error(String(err)));
          setIsLoading(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [threadPath]);

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

  const applyMeta = useCallback((meta: AgentThreadMetaState) => {
    const next = stateRef.current ? applyThreadMetaState(stateRef.current, meta) : null;
    if (next) {
      stateRef.current = next;
      setState(next);
    }
  }, []);

  const error = (watchError ?? sendMutation.error ?? abortMutation.error ?? null) as Error | null;

  return {
    state,
    seq,
    lastEvent,
    isLoading: isLoading && state === null,
    isSending: sendMutation.isPending,
    isAborting: abortMutation.isPending,
    error,
    send,
    abort,
    applyMeta,
  };
}

// ---------------------------------------------------------------------------
// Event processing — runs inside the async iterator loop, applies every
// update against stateRef (mutable) so nothing is ever skipped by React
// batching.  React setState calls are made for each update to trigger
// re-renders, but the source of truth is always the ref.
// ---------------------------------------------------------------------------

function processUpdate(
  update: AgentThreadWatchUpdate,
  stateRef: React.MutableRefObject<AgentThreadViewState | null>,
  setState: React.Dispatch<React.SetStateAction<AgentThreadViewState | null>>,
  setSeq: React.Dispatch<React.SetStateAction<number>>,
  setLastEvent: React.Dispatch<React.SetStateAction<AgentThreadEvent | null>>,
) {
  if (update.kind === "snapshot") {
    stateRef.current = update.state;
    setState(update.state);
    setLastEvent(null);
  } else {
    const current = stateRef.current;
    if (!current) return;

    let next = applyThreadEvent(current, update.event);
    next = applyThreadMetaState(next, update.meta);

    if (update.messageTail) {
      next = applyMessageTail(next, update.messageTail);
    }

    if ("streamMessage" in update) {
      next = { ...next, streamMessage: update.streamMessage ?? null };
    }

    stateRef.current = next;
    setState(next);
    setLastEvent(update.event);
  }

  setSeq(update.seq);
}

// ---------------------------------------------------------------------------
// Pure state helpers
// ---------------------------------------------------------------------------

function applyThreadMetaState(state: AgentThreadViewState, meta: AgentThreadMetaState): AgentThreadViewState {
  return {
    ...state,
    ...meta,
  };
}

/**
 * Apply a single event to the view state.
 *
 * Handles transient streaming state (`streamMessage`) and best-effort
 * incremental `message_end` appends.  The authoritative message list is
 * reconciled via `applyMessageTail` on checkpoint events (`turn_end`,
 * `agent_end`), so even if a `message_end` were somehow missed the
 * checkpoint corrects it.
 */
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

    case "agent_end": {
      return state.streamMessage === null ? state : { ...state, streamMessage: null };
    }

    default:
      return state;
  }
}

/**
 * Splice authoritative messages from a server checkpoint into the view state.
 *
 * `fromIndex` is the snapshot boundary.  The tail contains every message added
 * since that snapshot.  `messages.slice(0, fromIndex).concat(tail)` is
 * idempotent regardless of what the client already appended via `message_end`.
 * `fromIndex = 0` is a full reset (used after compaction).
 */
function applyMessageTail(state: AgentThreadViewState, tail: AgentThreadMessageTail): AgentThreadViewState {
  const base = state.messages.slice(0, tail.fromIndex);
  const merged = base.concat(tail.messages);

  if (merged.length === state.messages.length) {
    return state;
  }

  return {
    ...state,
    messages: merged,
  };
}
