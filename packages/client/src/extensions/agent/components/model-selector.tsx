import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import type { AgentThreadMetaState, AvailableModelInfo } from "@moderndev/server/src/extensions/agent/types";
import { useQuery } from "@tanstack/react-query";
import { Brain, Check, ChevronDown, Star } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { client } from "../../../lib/rpc";

// ---------------------------------------------------------------------------
// Thinking level helpers
// ---------------------------------------------------------------------------

const THINKING_LEVEL_LABELS: Record<string, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
};

function ThinkingDots({ level, levels }: { level: string; levels: string[] }) {
  const nonOff = levels.filter((l) => l !== "off");
  const index = nonOff.indexOf(level);
  if (index === -1) return null;
  const count = index + 1;
  const total = nonOff.length;

  return (
    <span className="inline-flex flex-col items-center gap-px">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn("size-1 rounded-full", i >= total - count ? "bg-current" : "bg-current opacity-20")}
        />
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Provider display helpers
// ---------------------------------------------------------------------------

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  "google-vertex": "Google Vertex",
  "google-gemini-cli": "Gemini CLI",
  xai: "xAI",
  groq: "Groq",
  cerebras: "Cerebras",
  openrouter: "OpenRouter",
  "vercel-ai-gateway": "Vercel AI Gateway",
  mistral: "Mistral",
  "amazon-bedrock": "Amazon Bedrock",
  "azure-openai-responses": "Azure OpenAI",
  "github-copilot": "GitHub Copilot",
  "openai-codex": "Codex",
  minimax: "MiniMax",
  "minimax-cn": "MiniMax CN",
  huggingface: "Hugging Face",
  opencode: "OpenCode",
  "kimi-coding": "Kimi",
  zai: "zAI",
};

function getProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

// ---------------------------------------------------------------------------
// Model key helper
// ---------------------------------------------------------------------------

function modelKey(model: { provider: string; id: string }): string {
  return `${model.provider}/${model.id}`;
}

// ---------------------------------------------------------------------------
// Group models by provider
// ---------------------------------------------------------------------------

function groupByProvider(models: AvailableModelInfo[]): Array<{ provider: string; models: AvailableModelInfo[] }> {
  const map = new Map<string, AvailableModelInfo[]>();

  for (const model of models) {
    let group = map.get(model.provider);
    if (!group) {
      group = [];
      map.set(model.provider, group);
    }
    group.push(model);
  }

  return Array.from(map.entries()).map(([provider, models]) => ({ provider, models }));
}

// ---------------------------------------------------------------------------
// ModelSelector component
// ---------------------------------------------------------------------------

interface ModelSelectorProps {
  threadPath: string | undefined;
  meta: AgentThreadMetaState | null;
  /** Called after a successful model or thinking level change so the parent can apply the meta. */
  onMetaUpdate: (meta: AgentThreadMetaState) => void;
  disabled?: boolean;
}

export function ModelSelector({ threadPath, meta, onMetaUpdate, disabled }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [thinkingPending, setThinkingPending] = useState(false);

  const starredModels = useSettings((s) => s.starredModels);
  const starredSet = useMemo(() => new Set(starredModels), [starredModels]);

  const modelsQuery = useQuery({
    queryKey: ["agent", "modelsList"],
    queryFn: () => client.agent.modelsList(),
    staleTime: 30_000,
  });

  const groups = useMemo(() => groupByProvider(modelsQuery.data?.models ?? []), [modelsQuery.data]);

  const currentModel = meta?.model ?? null;
  const currentThinking = meta?.thinkingLevel ?? "off";
  const supportsThinking = meta?.supportsThinking ?? false;

  // The server already includes "off" in availableThinkingLevels when the model
  // supports thinking. Keep only 3 levels: "off" + the 2 highest non-off levels.
  const availableLevels = useMemo(() => {
    const levels = meta?.availableThinkingLevels ?? ["off"];
    const nonOff = levels.filter((l) => l !== "off");
    return ["off", ...nonOff.slice(-3)];
  }, [meta?.availableThinkingLevels]);

  const handleSelectModel = useCallback(
    async (model: AvailableModelInfo) => {
      if (!threadPath) return;
      setOpen(false);
      try {
        const result = await client.agent.threadSetModel({
          threadPath,
          provider: model.provider,
          modelId: model.id,
        });
        onMetaUpdate(result.meta);
      } catch (err) {
        console.error("Failed to set model:", err);
      }
    },
    [threadPath, onMetaUpdate],
  );

  const toggleStar = useCallback(
    async (model: AvailableModelInfo, e: React.MouseEvent) => {
      e.stopPropagation();
      const key = modelKey(model);
      const next = starredSet.has(key) ? starredModels.filter((k) => k !== key) : [...starredModels, key];
      try {
        await client.settings.set({ path: ["starredModels"], value: next });
      } catch (err) {
        console.error("Failed to update starred models:", err);
      }
    },
    [starredModels, starredSet],
  );

  const cycleThinking = useCallback(async () => {
    if (!threadPath || !supportsThinking || thinkingPending) return;

    const currentIndex = availableLevels.indexOf(currentThinking);
    const nextIndex = (currentIndex + 1) % availableLevels.length;
    const nextLevel = availableLevels[nextIndex];

    setThinkingPending(true);
    try {
      const result = await client.agent.threadSetThinkingLevel({
        threadPath,
        level: nextLevel,
      });
      onMetaUpdate(result.meta);
    } catch (err) {
      console.error("Failed to set thinking level:", err);
    } finally {
      setThinkingPending(false);
    }
  }, [threadPath, supportsThinking, thinkingPending, availableLevels, currentThinking, onMetaUpdate]);

  if (!currentModel && !modelsQuery.data) {
    return null;
  }

  return (
    <div className="flex items-end text-xs text-white/50">
      {/* Model dropdown */}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            className="flex items-center gap-1 rounded px-1.5 py-1 transition-colors hover:bg-white/[0.06] hover:text-white/70 disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="truncate">{currentModel?.name ?? "Select model"}</span>
            <ChevronDown className="size-3 shrink-0 opacity-50" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="top" align="start" className="max-h-80 w-64 overflow-y-auto">
          {groups.map((group, gi) => (
            <DropdownMenuGroup key={group.provider}>
              {gi > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-xs text-white/40">
                {getProviderLabel(group.provider)}
              </DropdownMenuLabel>
              {group.models.map((model) => {
                const key = modelKey(model);
                const isSelected = currentModel?.provider === model.provider && currentModel?.id === model.id;
                const isStarred = starredSet.has(key);
                return (
                  <DropdownMenuItem
                    key={key}
                    onClick={() => void handleSelectModel(model)}
                    className="flex items-center gap-2"
                  >
                    <span className="min-w-0 flex-1 truncate">{model.name}</span>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => void toggleStar(model, e)}
                        className={cn(
                          "rounded p-0.5 transition-colors hover:text-amber-300",
                          isStarred ? "text-amber-400" : "text-white/20 hover:text-amber-300/60",
                        )}
                      >
                        <Star className={cn("size-3", isStarred && "fill-current")} />
                      </button>
                      {isSelected && <Check className="size-3.5 text-white/60" />}
                    </div>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          ))}

          {groups.length === 0 && (
            <div className="px-2 py-3 text-center text-xs text-white/30">No models available</div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Thinking level toggle */}
      {supportsThinking && (
        <>
          <button
            type="button"
            onClick={() => void cycleThinking()}
            disabled={disabled || thinkingPending}
            className={cn(
              "flex items-center gap-1.5 self-stretch rounded px-1.5 transition-colors hover:bg-white/[0.06] hover:text-white/70 disabled:pointer-events-none disabled:opacity-50",
              currentThinking !== "off" && "text-white/60",
            )}
            title={`Thinking: ${THINKING_LEVEL_LABELS[currentThinking] ?? currentThinking}`}
          >
            <Brain className="size-3 shrink-0" />
            {currentThinking !== "off" && (
              <>
                <ThinkingDots level={currentThinking} levels={availableLevels} />
                <span>{THINKING_LEVEL_LABELS[currentThinking] ?? currentThinking}</span>
              </>
            )}
          </button>
        </>
      )}
    </div>
  );
}
