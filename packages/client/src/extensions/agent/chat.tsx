import { useCallback, useMemo, useState } from "react";
import type { AgentThreadDeliveryMode } from "@diffs-io/server/src/extensions/agent/types";
import type { ExtensionPanelProps } from "../../lib/extensions";
import { useAgentThread } from "./use-agent-thread";

interface AgentChatPanelState {
  threadPath?: string;
}

export default function AgentChatPanel({ state }: ExtensionPanelProps<AgentChatPanelState>) {
  const threadPath = state.threadPath;
  const [draft, setDraft] = useState("");
  const thread = useAgentThread(threadPath);

  const isStreaming = Boolean(thread.state?.isStreaming);

  const disabled = thread.isSending || thread.isAborting || !threadPath;

  const serializedState = useMemo(() => {
    if (!thread.state) {
      return "{}";
    }

    return JSON.stringify(
      {
        seq: thread.seq,
        lastEventType: thread.lastEvent?.type,
        state: thread.state,
      },
      null,
      2,
    );
  }, [thread.lastEvent?.type, thread.seq, thread.state]);

  const send = useCallback(
    async (delivery: AgentThreadDeliveryMode) => {
      const text = draft.trim();
      if (!text) {
        return;
      }

      await thread.send(text, delivery);
      setDraft("");
    },
    [draft, thread],
  );

  const sendAuto = useCallback(async () => send("auto"), [send]);
  const sendSteer = useCallback(async () => send("steer"), [send]);
  const sendFollowUp = useCallback(async () => send("followUp"), [send]);

  if (!threadPath) {
    return <div className="size-full p-4 text-sm text-white/60">Missing thread path.</div>;
  }

  return (
    <div className="flex size-full flex-col gap-3 p-3">
      {thread.error ? (
        <div className="rounded border border-rose-400/40 bg-rose-500/10 p-2 text-xs text-rose-200">
          {thread.error.message}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto rounded border border-white/10 bg-black/20 p-3">
        <pre className="text-xs text-white/70 whitespace-pre-wrap break-words">{serializedState}</pre>
      </div>

      <div className="space-y-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder={isStreaming ? "Steer or queue a follow-up…" : "Send a message…"}
          className="min-h-24 w-full resize-y rounded border border-white/15 bg-black/30 p-2 text-sm text-white outline-none focus:border-white/35"
        />

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void sendAuto()}
            disabled={disabled}
            className="rounded border border-white/20 px-2 py-1 text-xs text-white/85 disabled:opacity-40"
          >
            Send
          </button>
          <button
            type="button"
            onClick={() => void sendSteer()}
            disabled={disabled}
            className="rounded border border-amber-300/30 px-2 py-1 text-xs text-amber-100 disabled:opacity-40"
          >
            Steer
          </button>
          <button
            type="button"
            onClick={() => void sendFollowUp()}
            disabled={disabled}
            className="rounded border border-emerald-300/30 px-2 py-1 text-xs text-emerald-100 disabled:opacity-40"
          >
            Follow-up
          </button>
          <button
            type="button"
            onClick={() => void thread.abort()}
            disabled={thread.isAborting || !isStreaming}
            className="rounded border border-rose-300/30 px-2 py-1 text-xs text-rose-100 disabled:opacity-40"
          >
            Abort
          </button>

          <div className="ml-auto text-xs text-white/50">
            {thread.isLoading ? "Loading…" : isStreaming ? "Streaming" : "Idle"}
          </div>
        </div>
      </div>
    </div>
  );
}
