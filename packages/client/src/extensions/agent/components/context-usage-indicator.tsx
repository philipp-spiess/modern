import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgentThreadContextUsage } from "@moderndev/server/src/extensions/agent/types";

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

function getColor(percent: number): string {
  if (percent > 90) return "rgb(248 113 113)"; // red-400
  if (percent > 70) return "rgb(251 191 36)"; // amber-400
  return "rgb(255 255 255 / 0.4)"; // white/40
}

function DonutSvg({ percent }: { percent: number }) {
  const size = 18;
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (percent / 100) * circumference;
  const color = getColor(percent);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
      {/* Background ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgb(255 255 255 / 0.08)"
        strokeWidth={strokeWidth}
      />
      {/* Filled arc */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={`${filled} ${circumference - filled}`}
        strokeDashoffset={circumference / 4}
        strokeLinecap="round"
        className="transition-all duration-300"
      />
    </svg>
  );
}

export function ContextUsageIndicator({ contextUsage }: { contextUsage: AgentThreadContextUsage | null }) {
  if (!contextUsage) return null;

  const percent = contextUsage.percent ?? 0;
  const percentDisplay = contextUsage.percent !== null ? `${percent.toFixed(1)}%` : "?";
  const tokensDisplay =
    contextUsage.tokens !== null
      ? `${formatTokens(contextUsage.tokens)} / ${formatTokens(contextUsage.contextWindow)}`
      : `? / ${formatTokens(contextUsage.contextWindow)}`;
  const remaining = contextUsage.percent !== null ? `${(100 - percent).toFixed(1)}% left` : "unknown";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="flex cursor-default items-center justify-center p-1" tabIndex={-1}>
          <DonutSvg percent={percent} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-center">
        <div className="font-medium">Context window:</div>
        <div>
          {percentDisplay} used ({remaining})
        </div>
        <div>{tokensDisplay} tokens used</div>
      </TooltipContent>
    </Tooltip>
  );
}
