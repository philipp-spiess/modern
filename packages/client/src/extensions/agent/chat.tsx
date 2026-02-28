import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { InputGroup, InputGroupAddon, InputGroupButton } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RichInput, type RichInputHandle } from "@/components/ui/rich-input";
import { cn } from "@/lib/utils";
import type {
  AgentThreadDeliveryMode,
  AgentThreadMetaState,
  AvailableModelInfo,
} from "@moderndev/server/src/extensions/agent/types";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { ArrowDown, Check, ChevronDown, Compass, CornerDownLeft, ListPlus, Loader2, Send, Square } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ExtensionPanelProps } from "../../lib/extensions";
import { queryClient } from "../../lib/query-client";
import { client, orpc } from "../../lib/rpc";
import { getSyncedSpinStyle } from "../../lib/spinner";
import { openProjectWithThread } from "../../lib/project";
import { ContextUsageIndicator } from "./components/context-usage-indicator";
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
import { WorkingIndicator } from "./components/working-indicator";
import { DiffStyleContext, useDiffStyleStore } from "./diff-style-context";
import { FollowUpQueueIndicator, MessageList, SteeringQueueIndicator } from "./messages";
import { useAgentThread } from "./use-agent-thread";

// ---------------------------------------------------------------------------
// Scroll area – manual scroll-anchoring that works in all browsers (Safari
// does not support CSS overflow-anchor).
//
// Two modes controlled by a `hasInteracted` flag:
//
//   1. Auto-scroll (initial load + streaming) – keep the view pinned to the
//      bottom so async content (diff highlighting, streaming tokens) is
//      visible as it arrives.
//
//   2. Anchored (after the user clicks or scrolls) – save the DOM node at
//      the top of the viewport and its pixel offset.  When a ResizeObserver
//      fires (before paint) we restore that offset, so collapsible
//      expand/collapse never jumps the view.
// ---------------------------------------------------------------------------

type ScrollToBottomFn = (behavior?: string) => void;

/** Distance from the bottom (px) within which we consider the user "at the bottom". */
const BOTTOM_THRESHOLD = 10;
const DRAFT_PREFERENCES_KEY = "agent:draftPreferences";

interface DraftPreferences {
  model: AvailableModelInfo | null;
  thinkingLevel: AgentThreadMetaState["thinkingLevel"];
  supportsThinking: boolean;
  availableThinkingLevels: string[];
  workspaceProviderId: string;
}

function createDefaultDraftPreferences(): DraftPreferences {
  return {
    model: null,
    thinkingLevel: "off",
    supportsThinking: false,
    availableThinkingLevels: ["off"],
    workspaceProviderId: "",
  };
}

function readDraftPreferencesFromStorage(): DraftPreferences | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFERENCES_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as {
      model?: unknown;
      thinkingLevel?: unknown;
      supportsThinking?: unknown;
      availableThinkingLevels?: unknown;
      workspaceProviderId?: unknown;
    };
    const model = parsed.model;

    const normalizedModel: AvailableModelInfo | null =
      typeof model === "object" &&
      model !== null &&
      typeof (model as AvailableModelInfo).provider === "string" &&
      typeof (model as AvailableModelInfo).id === "string" &&
      typeof (model as AvailableModelInfo).name === "string" &&
      typeof (model as AvailableModelInfo).reasoning === "boolean"
        ? {
            provider: (model as AvailableModelInfo).provider,
            id: (model as AvailableModelInfo).id,
            name: (model as AvailableModelInfo).name,
            reasoning: (model as AvailableModelInfo).reasoning,
          }
        : null;

    const thinkingLevel =
      typeof parsed.thinkingLevel === "string"
        ? (parsed.thinkingLevel as AgentThreadMetaState["thinkingLevel"])
        : "off";

    if (typeof parsed.supportsThinking !== "boolean") {
      return null;
    }

    if (
      !Array.isArray(parsed.availableThinkingLevels) ||
      !parsed.availableThinkingLevels.every((v) => typeof v === "string")
    ) {
      return null;
    }

    const availableThinkingLevels = Array.from(new Set(parsed.availableThinkingLevels.filter(Boolean)));
    if (!availableThinkingLevels.includes("off")) {
      availableThinkingLevels.unshift("off");
    }

    if (!availableThinkingLevels.includes(thinkingLevel)) {
      availableThinkingLevels.push(thinkingLevel);
    }

    return {
      model: normalizedModel,
      thinkingLevel,
      supportsThinking: parsed.supportsThinking,
      availableThinkingLevels,
      workspaceProviderId: typeof parsed.workspaceProviderId === "string" ? parsed.workspaceProviderId : "",
    };
  } catch {
    return null;
  }
}

function writeDraftPreferencesToStorage(preferences: DraftPreferences): void {
  try {
    localStorage.setItem(DRAFT_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Ignore storage errors.
  }
}

async function applyDraftPreferencesToThread(
  threadPath: string,
  { model, thinkingLevel }: Pick<DraftPreferences, "model" | "thinkingLevel">,
): Promise<void> {
  if (!model) {
    return;
  }

  const modelResult = await client.agent.threadSetModel({
    threadPath,
    provider: model.provider,
    modelId: model.id,
  });

  if (
    thinkingLevel !== "off" &&
    modelResult.meta.supportsThinking &&
    modelResult.meta.availableThinkingLevels.includes(thinkingLevel)
  ) {
    await client.agent.threadSetThinkingLevel({
      threadPath,
      level: thinkingLevel,
    });
  }
}

function ChatScrollArea({
  children,
  scrollToBottomRef,
  onIsAtBottomChange,
  threadPath,
  hasThreadState,
  isStreaming,
}: {
  children: ReactNode;
  scrollToBottomRef: React.MutableRefObject<ScrollToBottomFn | null>;
  onIsAtBottomChange: (value: boolean) => void;
  threadPath?: string;
  hasThreadState: boolean;
  isStreaming: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // -- anchor bookkeeping ---------------------------------------------------
  const anchorRef = useRef<{ node: Element; offset: number } | null>(null);
  const hasInteracted = useRef(false);
  const isStreamingRef = useRef(isStreaming);
  isStreamingRef.current = isStreaming;

  /** Snapshot the first content-child whose bottom is inside the viewport. */
  const saveAnchor = useCallback(() => {
    const scroll = scrollRef.current;
    const content = contentRef.current;
    if (!scroll || !content) return;
    const top = scroll.getBoundingClientRect().top;
    for (const child of content.children) {
      const r = child.getBoundingClientRect();
      if (r.bottom > top) {
        anchorRef.current = { node: child, offset: r.top - top };
        return;
      }
    }
  }, []);

  /** Adjust scrollTop so the anchored node sits at its saved offset. */
  const restoreAnchor = useCallback(() => {
    const scroll = scrollRef.current;
    const anchor = anchorRef.current;
    if (!scroll || !anchor || !anchor.node.isConnected) return;
    const top = scroll.getBoundingClientRect().top;
    const delta = anchor.node.getBoundingClientRect().top - top - anchor.offset;
    if (Math.abs(delta) > 0.5) scroll.scrollTop += delta;
  }, []);

  // -- public scroll-to-bottom ----------------------------------------------
  const scrollToBottom = useCallback((behavior?: string) => {
    const el = scrollRef.current;
    if (!el) return;
    hasInteracted.current = false; // re-engage auto-scroll
    el.scrollTo({
      top: el.scrollHeight - el.clientHeight,
      behavior: behavior === "smooth" ? "smooth" : "instant",
    });
  }, []);

  scrollToBottomRef.current = scrollToBottom;

  // -- scroll listener: keep anchor fresh + report isAtBottom ---------------
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      saveAnchor();
      onIsAtBottomChange(el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD);
    };
    el.addEventListener("scroll", handler, { passive: true });
    handler();
    return () => el.removeEventListener("scroll", handler);
  }, [onIsAtBottomChange, saveAnchor]);

  // -- detect first user interaction (switches to anchor mode) --------------
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      hasInteracted.current = true;
      saveAnchor();
    };
    el.addEventListener("pointerdown", handler, { passive: true });
    el.addEventListener("wheel", handler, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", handler);
      el.removeEventListener("wheel", handler);
    };
  }, [saveAnchor]);

  // -- ResizeObserver: auto-scroll OR restore anchor (fires before paint) ---
  useEffect(() => {
    const scroll = scrollRef.current;
    const content = contentRef.current;
    if (!scroll || !content) return;
    const observer = new ResizeObserver(() => {
      if (isStreamingRef.current || !hasInteracted.current) {
        // Auto-scroll mode: keep pinned to the bottom.
        const dist = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
        if (dist > 0.5) scroll.scrollTop = scroll.scrollHeight - scroll.clientHeight;
      } else {
        restoreAnchor();
      }
      saveAnchor();
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [restoreAnchor, saveAnchor]);

  // -- reset on thread switch -----------------------------------------------
  useEffect(() => {
    hasInteracted.current = false;
    anchorRef.current = null;
  }, [threadPath]);

  // -- initial scroll-to-bottom (layout effect → before first paint) --------
  const scrolledForThread = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (threadPath && hasThreadState && el && scrolledForThread.current !== threadPath) {
      el.scrollTop = el.scrollHeight;
      scrolledForThread.current = threadPath;
    }
  }, [threadPath, hasThreadState]);

  return (
    <div ref={scrollRef} role="log" className="min-h-0 flex-1 overflow-y-auto px-4">
      <div ref={contentRef} className="flex flex-col pb-10">
        {children}
      </div>
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

  const [hasContent, setHasContent] = useState(false);
  const [draftPreferences, setDraftPreferences] = useState<DraftPreferences>(
    () => readDraftPreferencesFromStorage() ?? createDefaultDraftPreferences(),
  );
  const [draftPreferencesLoaded, setDraftPreferencesLoaded] = useState(() =>
    Boolean(readDraftPreferencesFromStorage()),
  );
  const richInputRef = useRef<RichInputHandle>(null);
  const threadViewRef = useRef<HTMLDivElement>(null);
  const diffStyle = useDiffStyleStore();
  const thread = useAgentThread(isDraftThread ? undefined : threadPath);
  const scrollToBottomRef = useRef<ScrollToBottomFn | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [workspaceProviderMenuOpen, setWorkspaceProviderMenuOpen] = useState(false);
  const draftModelMetaRequestId = useRef(0);
  const draftModel = draftPreferences.model;
  const draftThinkingLevel = draftPreferences.thinkingLevel;
  const draftSupportsThinking = draftPreferences.supportsThinking;
  const draftAvailableThinkingLevels = draftPreferences.availableThinkingLevels;
  const workspaceProviderId = draftPreferences.workspaceProviderId;

  const workspaceProvidersQuery = useSuspenseQuery(
    orpc.project.workspaceProviders.queryOptions({
      queryKey: ["project", "workspaceProviders", workspaceCwd ?? ""],
      input: workspaceCwd ? { cwd: workspaceCwd } : undefined,
      context: { cache: true },
    }),
  );

  const workspaceProviders = useMemo(
    () => workspaceProvidersQuery.data.providers ?? [],
    [workspaceProvidersQuery.data],
  );

  useEffect(() => {
    if (!isDraftThread) {
      return;
    }

    const storedPreferences = readDraftPreferencesFromStorage();
    if (storedPreferences) {
      setDraftPreferences(storedPreferences);
      setDraftPreferencesLoaded(true);
      return;
    }

    if (!workspaceCwd) {
      setDraftPreferences(createDefaultDraftPreferences());
      setDraftPreferencesLoaded(true);
      return;
    }

    let cancelled = false;
    setDraftPreferencesLoaded(false);

    void (async () => {
      try {
        const { defaults } = await client.agent.draftDefaults({ projectCwd: workspaceCwd });
        if (cancelled) {
          return;
        }

        const nextPreferences: DraftPreferences = {
          model: defaults.model,
          thinkingLevel: defaults.thinkingLevel,
          supportsThinking: defaults.supportsThinking,
          availableThinkingLevels: defaults.availableThinkingLevels,
          workspaceProviderId: readDraftPreferencesFromStorage()?.workspaceProviderId ?? "",
        };

        setDraftPreferences(nextPreferences);
        writeDraftPreferencesToStorage(nextPreferences);
      } catch (error) {
        setDraftPreferences(createDefaultDraftPreferences());
        console.error("Failed to load draft thread defaults:", error);
      } finally {
        if (!cancelled) {
          setDraftPreferencesLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isDraftThread, workspaceCwd]);

  useEffect(() => {
    if (!isDraftThread || !draftPreferencesLoaded) {
      return;
    }

    writeDraftPreferencesToStorage(draftPreferences);
  }, [draftPreferences, draftPreferencesLoaded, isDraftThread]);

  useEffect(() => {
    if (!workspaceProviderId) {
      return;
    }

    if (!workspaceProviders.some((provider) => provider.id === workspaceProviderId)) {
      setDraftPreferences((current) => ({ ...current, workspaceProviderId: "" }));
    }
  }, [workspaceProviderId, workspaceProviders]);

  useEffect(() => {
    if (isDraftThread || !thread.state?.model) {
      return;
    }

    writeDraftPreferencesToStorage({
      model: {
        provider: thread.state.model.provider,
        id: thread.state.model.id,
        name: thread.state.model.name,
        reasoning: thread.state.supportsThinking,
      },
      thinkingLevel: thread.state.thinkingLevel,
      supportsThinking: thread.state.supportsThinking,
      availableThinkingLevels: thread.state.availableThinkingLevels,
      workspaceProviderId: readDraftPreferencesFromStorage()?.workspaceProviderId ?? "",
    });
  }, [isDraftThread, thread.state]);

  const createThreadFromDraftMutation = useMutation({
    mutationFn: async ({
      text,
      preferences,
      workspaceProviderId,
    }: {
      text: string;
      preferences: Pick<DraftPreferences, "model" | "thinkingLevel">;
      workspaceProviderId?: string;
    }) => {
      if (!workspaceCwd) {
        throw new Error("Cannot create a thread without an active project.");
      }

      const created = await client.agent.threadCreate({
        projectCwd: workspaceCwd,
        ...(workspaceProviderId ? { workspaceProviderId } : {}),
      });
      await openProjectWithThread(created.cwd || workspaceCwd, created.threadPath, "New Thread");

      try {
        await applyDraftPreferencesToThread(created.threadPath, preferences);
      } catch (error) {
        console.error("Failed to apply draft model preference:", error);
      }

      await client.agent.threadSend({
        threadPath: created.threadPath,
        text,
        delivery: "auto",
      });

      void queryClient.invalidateQueries({ queryKey: ["agent", "threadsList"] });
    },
  });

  const isStreaming = !isDraftThread && Boolean(thread.state?.isStreaming);
  const canAbortTurnWithEscape = !isDraftThread && (isStreaming || thread.isSending) && !thread.isAborting;
  const disabled =
    thread.isSending ||
    thread.isAborting ||
    createThreadFromDraftMutation.isPending ||
    (isDraftThread && !draftPreferencesLoaded) ||
    (!isDraftThread && !threadPath);

  useEffect(() => {
    if (!canAbortTurnWithEscape) {
      return;
    }

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.repeat) {
        return;
      }

      const container = threadViewRef.current;
      if (!container) {
        return;
      }

      const target = event.target;
      const activeElement = document.activeElement;
      const targetInThreadView = target instanceof Node && container.contains(target);
      const focusInThreadView = activeElement instanceof Node && container.contains(activeElement);

      if (!targetInThreadView && !focusInThreadView) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void thread.abort();
    };

    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => window.removeEventListener("keydown", handleWindowKeyDown, true);
  }, [canAbortTurnWithEscape, thread]);

  const handleDraftModelChange = useCallback(
    (model: AvailableModelInfo | null) => {
      if (!model) {
        setDraftPreferences((current) => ({
          ...createDefaultDraftPreferences(),
          workspaceProviderId: current.workspaceProviderId,
        }));
        return;
      }

      if (!model.reasoning) {
        setDraftPreferences((current) => ({
          ...current,
          model,
          thinkingLevel: "off",
          supportsThinking: false,
          availableThinkingLevels: ["off"],
        }));
        return;
      }

      setDraftPreferences((current) => ({
        ...current,
        model,
        supportsThinking: true,
        availableThinkingLevels: ["off"],
      }));

      if (!workspaceCwd) {
        return;
      }

      const requestId = ++draftModelMetaRequestId.current;

      void (async () => {
        try {
          const { defaults } = await client.agent.draftDefaults({
            projectCwd: workspaceCwd,
            provider: model.provider,
            modelId: model.id,
          });

          if (requestId !== draftModelMetaRequestId.current) {
            return;
          }

          setDraftPreferences((current) => ({
            ...current,
            supportsThinking: defaults.supportsThinking,
            availableThinkingLevels: defaults.availableThinkingLevels,
            thinkingLevel: defaults.availableThinkingLevels.includes(current.thinkingLevel)
              ? current.thinkingLevel
              : defaults.thinkingLevel,
          }));
        } catch (error) {
          if (requestId !== draftModelMetaRequestId.current) {
            return;
          }

          console.error("Failed to load draft model metadata:", error);
        }
      })();
    },
    [workspaceCwd],
  );

  const handleDraftThinkingLevelChange = useCallback((level: AgentThreadMetaState["thinkingLevel"]) => {
    setDraftPreferences((current) => ({ ...current, thinkingLevel: level }));
  }, []);

  const send = useCallback(
    async (delivery: AgentThreadDeliveryMode) => {
      const text = richInputRef.current?.getText().trim();
      if (!text) {
        return;
      }

      richInputRef.current?.clear();
      setHasContent(false);
      scrollToBottomRef.current?.("smooth");

      if (isDraftThread) {
        await createThreadFromDraftMutation.mutateAsync({
          text,
          preferences: {
            model: draftModel,
            thinkingLevel: draftThinkingLevel,
          },
          workspaceProviderId: workspaceProviderId || undefined,
        });
        return;
      }

      await thread.send(text, delivery);
    },
    [createThreadFromDraftMutation, draftModel, draftThinkingLevel, isDraftThread, thread, workspaceProviderId],
  );

  const handleEnter = useCallback(() => {
    void send("auto");
    return true;
  }, [send]);

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
      <div ref={threadViewRef} className="relative flex size-full flex-col">
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
          isStreaming={isStreaming}
        >
          {isDraftThread ? (
            <div className="flex flex-1 items-center justify-center py-10 text-center text-sm text-white/40">
              Send your first message to start this thread.
            </div>
          ) : thread.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-white/40">
              <Loader2 className="size-4 animate-spin" style={getSyncedSpinStyle()} />
              Loading thread…
            </div>
          ) : thread.state ? (
            <>
              <MessageList
                messages={thread.state.messages}
                streamMessage={thread.state.streamMessage}
                isStreaming={isStreaming}
                showThinkingPlaceholder={thread.state.supportsThinking && thread.state.thinkingLevel !== "off"}
              />
              <SteeringQueueIndicator items={steeringQueue} />
              <FollowUpQueueIndicator items={followUpQueue} />
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

        <div className="relative p-2 pt-0">
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
          <div className="relative">
            {isStreaming && (
              <div className="absolute bottom-full left-0 pb-1">
                <WorkingIndicator />
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send("auto");
              }}
            >
              <InputGroup
                style={{ borderRadius: 8 }}
                className={cn(
                  "border-0 inset-ring inset-ring-white/12 bg-white/[0.03]",
                  isStreaming && "inset-ring-white/20",
                )}
              >
                <div className="relative w-full flex-1">
                  <RichInput
                    ref={richInputRef}
                    autoFocus
                    onChange={setHasContent}
                    onEnter={handleEnter}
                    placeholder={
                      createThreadFromDraftMutation.isPending
                        ? "Creating thread…"
                        : isDraftThread && !draftPreferencesLoaded
                          ? "Loading model defaults…"
                          : isStreaming
                            ? "Steer or queue a follow-up…"
                            : "Send a message…"
                    }
                    className="field-sizing-content max-h-36 min-h-10"
                  />
                </div>
                <InputGroupAddon align="block-end" className="-ml-3 items-center justify-between">
                  <div className="flex items-center gap-1">
                    <ModelSelector
                      threadPath={threadPath}
                      meta={thread.state ?? null}
                      onMetaUpdate={handleMetaUpdate}
                      draftModel={draftModel}
                      draftThinkingLevel={draftThinkingLevel}
                      draftSupportsThinking={draftSupportsThinking}
                      draftAvailableThinkingLevels={draftAvailableThinkingLevels}
                      onDraftModelChange={handleDraftModelChange}
                      onDraftThinkingLevelChange={handleDraftThinkingLevelChange}
                      disabled={createThreadFromDraftMutation.isPending || (isDraftThread && !draftPreferencesLoaded)}
                    />
                    {isDraftThread ? (
                      <Popover open={workspaceProviderMenuOpen} onOpenChange={setWorkspaceProviderMenuOpen}>
                        <PopoverTrigger asChild disabled={createThreadFromDraftMutation.isPending || !workspaceCwd}>
                          <button
                            type="button"
                            className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white/70 disabled:pointer-events-none disabled:opacity-50"
                            aria-label="Workspace provider"
                          >
                            <span className="truncate">
                              {workspaceProviderId
                                ? (workspaceProviders.find((provider) => provider.id === workspaceProviderId)?.title ??
                                  "Project workspace")
                                : "Project workspace"}
                            </span>
                            <ChevronDown className="size-3 shrink-0 opacity-50" />
                          </button>
                        </PopoverTrigger>

                        <PopoverContent side="top" align="start" className="w-56 p-0">
                          <Command>
                            <CommandList>
                              <CommandGroup>
                                <CommandItem
                                  value="project-workspace"
                                  onSelect={() => {
                                    setDraftPreferences((current) => ({ ...current, workspaceProviderId: "" }));
                                    setWorkspaceProviderMenuOpen(false);
                                  }}
                                  className="flex items-center gap-2"
                                >
                                  <span className="min-w-0 flex-1 truncate">Project workspace</span>
                                  {!workspaceProviderId && <Check className="size-3.5 text-white/60" />}
                                </CommandItem>
                                {workspaceProviders.map((provider) => (
                                  <CommandItem
                                    key={provider.id}
                                    value={provider.title}
                                    onSelect={() => {
                                      setDraftPreferences((current) => ({
                                        ...current,
                                        workspaceProviderId: provider.id,
                                      }));
                                      setWorkspaceProviderMenuOpen(false);
                                    }}
                                    className="flex items-center gap-2"
                                  >
                                    <span className="min-w-0 flex-1 truncate">{provider.title}</span>
                                    {workspaceProviderId === provider.id ? (
                                      <Check className="size-3.5 text-white/60" />
                                    ) : null}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    ) : null}
                    {isStreaming && (
                      <>
                        <InputGroupButton
                          type="button"
                          onClick={() => void send("steer")}
                          disabled={disabled || !hasContent}
                          className="text-amber-300/70 hover:text-amber-300"
                        >
                          <Compass className="size-3.5" />
                          <span>Steer</span>
                        </InputGroupButton>
                        <InputGroupButton
                          type="button"
                          onClick={() => void send("followUp")}
                          disabled={disabled || !hasContent}
                          className="text-emerald-300/70 hover:text-emerald-300"
                        >
                          <ListPlus className="size-3.5" />
                          <span>Follow-up</span>
                        </InputGroupButton>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <ContextUsageIndicator contextUsage={thread.state?.contextUsage ?? null} />
                    {isStreaming ? (
                      <>
                        <InputGroupButton type="submit" disabled={disabled || !hasContent}>
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
                      <InputGroupButton
                        type="submit"
                        variant="default"
                        size="icon-xs"
                        disabled={disabled || !hasContent}
                      >
                        <CornerDownLeft className="size-3" />
                      </InputGroupButton>
                    )}
                  </div>
                </InputGroupAddon>
              </InputGroup>
            </form>
          </div>
        </div>
      </div>
    </DiffStyleContext.Provider>
  );
}
