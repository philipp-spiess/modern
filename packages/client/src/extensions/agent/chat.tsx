import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import type { AgentThreadDeliveryMode, AgentThreadMetaState } from "@moderndev/server/src/extensions/agent/types";
import { useMutation } from "@tanstack/react-query";
import { ArrowDown, Compass, CornerDownLeft, ListPlus, Loader2, Send, Square } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ExtensionPanelProps } from "../../lib/extensions";
import { queryClient } from "../../lib/query-client";
import { client } from "../../lib/rpc";
import { openWorkspaceWithThread } from "../../lib/workspace";
import { ModelSelector } from "./components/model-selector";
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemIndicator,
  QueueSection,
  QueueSectionContent,
  QueueSectionTrigger,
} from "./components/queue";
import { DiffStyleContext, useDiffStyleStore } from "./diff-style-context";
import { FollowUpQueueIndicator, MessageList, SteeringQueueIndicator } from "./messages";
import { useAgentThread } from "./use-agent-thread";

// ---------------------------------------------------------------------------
// Scroll area – uses CSS flex-direction: column-reverse so the container
// naturally starts scrolled to the bottom.  The browser's built-in scroll
// anchoring (overflow-anchor) keeps the viewport stable when content changes
// size (async diff highlighting, collapsible expand/collapse) — all in the
// same layout pass, zero flicker, no JS observers needed.
//
// In column-reverse, scrollTop=0 is the visual bottom.  Scrolling up yields
// negative scrollTop values.
// ---------------------------------------------------------------------------

type ScrollToBottomFn = (behavior?: string) => void;

/** Threshold in px to consider the user "at the bottom". */
const BOTTOM_THRESHOLD = 10;

function ChatScrollArea({
  children,
  scrollToBottomRef,
  onIsAtBottomChange,
  threadPath,
  hasThreadState,
}: {
  children: ReactNode;
  scrollToBottomRef: React.MutableRefObject<ScrollToBottomFn | null>;
  onIsAtBottomChange: (value: boolean) => void;
  threadPath?: string;
  hasThreadState: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback((behavior?: string) => {
    scrollRef.current?.scrollTo({
      top: 0,
      behavior: behavior === "smooth" ? "smooth" : "instant",
    });
  }, []);

  scrollToBottomRef.current = scrollToBottom;

  // Track whether the user is at the bottom via scroll events.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      onIsAtBottomChange(Math.abs(el.scrollTop) <= BOTTOM_THRESHOLD);
    };
    el.addEventListener("scroll", handler, { passive: true });
    handler();
    return () => el.removeEventListener("scroll", handler);
  }, [onIsAtBottomChange]);

  // Reset scroll to bottom when switching threads.
  const scrolledForThread = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (threadPath && hasThreadState && el && scrolledForThread.current !== threadPath) {
      el.scrollTop = 0;
      scrolledForThread.current = threadPath;
    }
  }, [threadPath, hasThreadState]);

  return (
    <div ref={scrollRef} role="log" className="min-h-0 flex-1 flex flex-col-reverse overflow-y-auto px-4">
      <div className="flex flex-col pb-4">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface AgentChatPanelState {
  threadPath?: string;
  mode?: "draft";
}

export default function AgentChatPanel({ state, workspaceCwd }: ExtensionPanelProps<AgentChatPanelState>) {
  const threadPath = state.threadPath;
  const isDraftThread = state.mode === "draft" || !threadPath;

  const [draft, setDraft] = useState("");
  const diffStyle = useDiffStyleStore();
  const thread = useAgentThread(isDraftThread ? undefined : threadPath);
  const scrollToBottomRef = useRef<ScrollToBottomFn | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const createThreadFromDraftMutation = useMutation({
    mutationFn: async (text: string) => {
      if (!workspaceCwd) {
        throw new Error("Cannot create a thread without an active workspace.");
      }

      const created = await client.agent.threadCreate({ cwd: workspaceCwd });
      await openWorkspaceWithThread(workspaceCwd, created.threadPath, "New Thread");
      await client.agent.threadSend({
        threadPath: created.threadPath,
        text,
        delivery: "auto",
      });

      void queryClient.invalidateQueries({ queryKey: ["agent", "threadsList"] });
    },
  });

  const isStreaming = !isDraftThread && Boolean(thread.state?.isStreaming);
  const disabled =
    thread.isSending || thread.isAborting || createThreadFromDraftMutation.isPending || (!isDraftThread && !threadPath);

  const send = useCallback(
    async (delivery: AgentThreadDeliveryMode) => {
      const text = draft.trim();
      if (!text) {
        return;
      }

      setDraft("");
      scrollToBottomRef.current?.("smooth");

      if (isDraftThread) {
        await createThreadFromDraftMutation.mutateAsync(text);
        return;
      }

      await thread.send(text, delivery);
    },
    [createThreadFromDraftMutation, draft, isDraftThread, thread],
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

  const handleMetaUpdate = useCallback(
    (meta: AgentThreadMetaState) => {
      thread.applyMeta(meta);
    },
    [thread],
  );

  const steeringQueue = !isDraftThread ? (thread.state?.steeringQueue ?? []) : [];
  const followUpQueue = !isDraftThread ? (thread.state?.followUpQueue ?? []) : [];
  const hasQueued = steeringQueue.length > 0 || followUpQueue.length > 0;
  const error = (createThreadFromDraftMutation.error ?? thread.error ?? null) as Error | null;

  return (
    <DiffStyleContext.Provider value={diffStyle}>
      <div className="relative flex size-full flex-col">
        {error && (
          <div className="mx-3 mt-3 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error.message}
          </div>
        )}

        <ChatScrollArea
          scrollToBottomRef={scrollToBottomRef}
          onIsAtBottomChange={setIsAtBottom}
          threadPath={threadPath}
          hasThreadState={Boolean(thread.state)}
        >
          {isDraftThread ? (
            <div className="flex flex-1 items-center justify-center py-10 text-center text-sm text-white/40">
              Send your first message to start this thread.
            </div>
          ) : thread.isLoading ? (
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
              <SteeringQueueIndicator items={steeringQueue} />
              <FollowUpQueueIndicator items={followUpQueue} />
              {isStreaming && !thread.state.streamMessage && (
                <div className="flex items-center gap-2 py-3 text-xs text-white/30">
                  <span className="size-1.5 animate-pulse rounded-full bg-white/40" />
                  Thinking…
                </div>
              )}
            </>
          ) : null}
        </ChatScrollArea>

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

        <div className="relative p-3 pt-0">
          {!isAtBottom && (
            <div className="pointer-events-none absolute inset-x-0 -top-10 z-10 flex justify-center">
              <button
                type="button"
                onClick={() => {
                  void scrollToBottomRef.current?.("smooth");
                }}
                className="pointer-events-auto rounded-full border border-white/15 bg-neutral-900/90 p-1.5 text-white/60 shadow-lg backdrop-blur-sm transition-colors hover:text-white/80"
              >
                <ArrowDown className="size-3.5" />
              </button>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send("auto");
            }}
          >
            <InputGroup
              className={cn(
                "border-0 inset-ring inset-ring-white/12 bg-white/[0.03]",
                isStreaming && "inset-ring-white/20",
              )}
            >
              <InputGroupTextarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  createThreadFromDraftMutation.isPending
                    ? "Creating thread…"
                    : isStreaming
                      ? "Steer or queue a follow-up…"
                      : "Send a message…"
                }
                className="field-sizing-content max-h-36 min-h-10"
              />
              <InputGroupAddon align="block-end" className="-ml-3 items-end justify-between">
                <div className="flex items-center gap-1">
                  <ModelSelector
                    threadPath={threadPath}
                    meta={thread.state ?? null}
                    onMetaUpdate={handleMetaUpdate}
                    disabled={isDraftThread}
                  />
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
    </DiffStyleContext.Provider>
  );
}
