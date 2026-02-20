import { useCallback, useState } from "react";
import { Loader2, Send, Compass, ListPlus, Square, CornerDownLeft } from "lucide-react";
import type { AgentThreadDeliveryMode } from "@diffs-io/server/src/extensions/agent/types";
import type { ExtensionPanelProps } from "../../lib/extensions";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import { useStickToBottom } from "use-stick-to-bottom";
import { useAgentThread } from "./use-agent-thread";
import { MessageList, SteeringQueueIndicator, FollowUpQueueIndicator } from "./messages";
import {
  Queue,
  QueueSection,
  QueueSectionTrigger,
  QueueSectionContent,
  QueueItem,
  QueueItemIndicator,
  QueueItemContent,
} from "./components/queue";

interface AgentChatPanelState {
  threadPath?: string;
}

export default function AgentChatPanel({ state }: ExtensionPanelProps<AgentChatPanelState>) {
  const threadPath = state.threadPath;
  const [draft, setDraft] = useState("");
  const thread = useAgentThread(threadPath);
  const { contentRef, isAtBottom, scrollRef, scrollToBottom } = useStickToBottom({
    initial: "instant",
    resize: "instant",
  });

  const isStreaming = Boolean(thread.state?.isStreaming);
  const disabled = thread.isSending || thread.isAborting || !threadPath;

  const send = useCallback(
    async (delivery: AgentThreadDeliveryMode) => {
      const text = draft.trim();
      if (!text) return;
      setDraft("");
      void scrollToBottom("smooth");
      await thread.send(text, delivery);
    },
    [draft, scrollToBottom, thread],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void send("auto");
      }
    },
    [send],
  );

  if (!threadPath) {
    return <div className="size-full p-4 text-sm text-white/60">Missing thread path.</div>;
  }

  const steeringQueue = thread.state?.steeringQueue ?? [];
  const followUpQueue = thread.state?.followUpQueue ?? [];
  const hasQueued = steeringQueue.length > 0 || followUpQueue.length > 0;

  return (
    <div className="flex size-full flex-col">
      {/* Error banner */}
      {thread.error && (
        <div className="mx-3 mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {thread.error.message}
        </div>
      )}

      {/* Messages area */}
      <div ref={scrollRef} role="log" className="min-h-0 flex-1 overflow-y-auto px-4">
        <div ref={contentRef} className="flex flex-col pb-4">
          {thread.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-white/40">
              <Loader2 className="size-4 animate-spin" />
              Loading thread…
            </div>
          ) : thread.state ? (
            <>
              <MessageList
                messages={thread.state.messages}
                streamMessage={thread.state.streamMessage}
                isStreaming={isStreaming}
              />
              {/* Queue indicators */}
              <SteeringQueueIndicator items={steeringQueue} />
              <FollowUpQueueIndicator items={followUpQueue} />
              {/* Streaming indicator */}
              {isStreaming && !thread.state.streamMessage && (
                <div className="flex items-center gap-2 py-3 text-xs text-white/30">
                  <span className="size-1.5 animate-pulse rounded-full bg-white/40" />
                  Thinking…
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>

      {/* Scroll-to-bottom indicator */}
      {!isAtBottom && (
        <div className="relative z-10 -mt-10 flex justify-center">
          <button
            type="button"
            onClick={() => {
              void scrollToBottom("smooth");
            }}
            className="rounded-full border border-white/15 bg-neutral-900/90 px-3 py-1 text-xs text-white/60 shadow-lg backdrop-blur-sm transition-colors hover:text-white/80"
          >
            Scroll to bottom
          </button>
        </div>
      )}

      {/* Queue display */}
      {hasQueued && (
        <div className="px-3 pt-2">
          <Queue>
            {steeringQueue.length > 0 && (
              <QueueSection>
                <QueueSectionTrigger
                  count={steeringQueue.length}
                  label={steeringQueue.length === 1 ? "steering message" : "steering messages"}
                  icon={<Compass className="size-3 text-amber-300/70" />}
                />
                <QueueSectionContent>
                  <ul className="mt-1">
                    {steeringQueue.map((text, i) => (
                      <QueueItem key={i}>
                        <QueueItemIndicator />
                        <QueueItemContent>{text}</QueueItemContent>
                      </QueueItem>
                    ))}
                  </ul>
                </QueueSectionContent>
              </QueueSection>
            )}
            {followUpQueue.length > 0 && (
              <QueueSection>
                <QueueSectionTrigger
                  count={followUpQueue.length}
                  label={followUpQueue.length === 1 ? "follow-up" : "follow-ups"}
                  icon={<ListPlus className="size-3 text-emerald-300/70" />}
                />
                <QueueSectionContent>
                  <ul className="mt-1">
                    {followUpQueue.map((text, i) => (
                      <QueueItem key={i}>
                        <QueueItemIndicator />
                        <QueueItemContent>{text}</QueueItemContent>
                      </QueueItem>
                    ))}
                  </ul>
                </QueueSectionContent>
              </QueueSection>
            )}
          </Queue>
        </div>
      )}

      {/* Input area (AI Elements PromptInput pattern) */}
      <div className="border-t border-white/8 p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send("auto");
          }}
        >
          <InputGroup className={cn("border-white/12 bg-white/[0.03]", isStreaming && "border-white/20")}>
            <InputGroupTextarea
              value={draft}
              onChange={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              placeholder={isStreaming ? "Steer or queue a follow-up…" : "Send a message…"}
              className="field-sizing-content max-h-36 min-h-10"
            />
            <InputGroupAddon align="block-end" className="justify-between">
              {/* Left: delivery mode buttons (only during streaming) */}
              <div className="flex items-center gap-1">
                {isStreaming && (
                  <>
                    <InputGroupButton
                      type="button"
                      onClick={() => void send("steer")}
                      disabled={disabled || !draft.trim()}
                      className="text-amber-300/70 hover:text-amber-300"
                    >
                      <Compass className="size-3.5" />
                      <span>Steer</span>
                    </InputGroupButton>
                    <InputGroupButton
                      type="button"
                      onClick={() => void send("followUp")}
                      disabled={disabled || !draft.trim()}
                      className="text-emerald-300/70 hover:text-emerald-300"
                    >
                      <ListPlus className="size-3.5" />
                      <span>Follow-up</span>
                    </InputGroupButton>
                  </>
                )}
              </div>

              {/* Right: submit / abort */}
              <div className="flex items-center gap-1">
                {isStreaming ? (
                  <>
                    <InputGroupButton type="submit" disabled={disabled || !draft.trim()}>
                      <Send className="size-3.5" />
                    </InputGroupButton>
                    <InputGroupButton
                      type="button"
                      onClick={() => void thread.abort()}
                      disabled={thread.isAborting}
                      className="text-rose-300/70 hover:text-rose-300"
                    >
                      <Square className="size-3.5" />
                      <span>Stop</span>
                    </InputGroupButton>
                  </>
                ) : (
                  <InputGroupButton type="submit" variant="default" disabled={disabled || !draft.trim()}>
                    <CornerDownLeft className="size-3.5" />
                  </InputGroupButton>
                )}
              </div>
            </InputGroupAddon>
          </InputGroup>
        </form>
      </div>
    </div>
  );
}
