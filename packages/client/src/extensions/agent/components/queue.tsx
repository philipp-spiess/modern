import type { ComponentProps, HTMLAttributes } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronDownIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Queue container
// ---------------------------------------------------------------------------

export type QueueProps = HTMLAttributes<HTMLDivElement>;

export const Queue = ({ className, ...props }: QueueProps) => (
  <div
    className={cn("flex flex-col gap-1.5 rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2", className)}
    {...props}
  />
);

// ---------------------------------------------------------------------------
// Queue section (collapsible)
// ---------------------------------------------------------------------------

export type QueueSectionProps = ComponentProps<typeof Collapsible>;

export const QueueSection = ({ className, defaultOpen = true, ...props }: QueueSectionProps) => (
  <Collapsible className={cn(className)} defaultOpen={defaultOpen} {...props} />
);

// ---------------------------------------------------------------------------
// Queue section trigger
// ---------------------------------------------------------------------------

export interface QueueSectionTriggerProps {
  count?: number;
  label: string;
  icon?: React.ReactNode;
  className?: string;
}

export const QueueSectionTrigger = ({ count, label, icon, className }: QueueSectionTriggerProps) => (
  <CollapsibleTrigger asChild>
    <button
      type="button"
      className={cn(
        "group/trigger flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-white/50 transition-colors hover:text-white/70",
        className,
      )}
    >
      <ChevronDownIcon className="size-3 transition-transform group-data-[state=closed]/trigger:-rotate-90" />
      {icon}
      <span>
        {count} {label}
      </span>
    </button>
  </CollapsibleTrigger>
);

// ---------------------------------------------------------------------------
// Queue section content
// ---------------------------------------------------------------------------

export type QueueSectionContentProps = ComponentProps<typeof CollapsibleContent>;

export const QueueSectionContent = ({ className, ...props }: QueueSectionContentProps) => (
  <CollapsibleContent className={cn(className)} {...props} />
);

// ---------------------------------------------------------------------------
// Queue item
// ---------------------------------------------------------------------------

export type QueueItemProps = HTMLAttributes<HTMLLIElement>;

export const QueueItem = ({ className, ...props }: QueueItemProps) => (
  <li
    className={cn(
      "flex items-start gap-2 rounded px-2 py-1 text-xs text-white/40 transition-colors hover:bg-white/5",
      className,
    )}
    {...props}
  />
);

// ---------------------------------------------------------------------------
// Queue item indicator
// ---------------------------------------------------------------------------

export type QueueItemIndicatorProps = HTMLAttributes<HTMLSpanElement> & {
  completed?: boolean;
};

export const QueueItemIndicator = ({ completed = false, className, ...props }: QueueItemIndicatorProps) => (
  <span
    className={cn(
      "mt-1 inline-block size-2 rounded-full border",
      completed ? "border-white/10 bg-white/10" : "border-white/30",
      className,
    )}
    {...props}
  />
);

// ---------------------------------------------------------------------------
// Queue item content
// ---------------------------------------------------------------------------

export type QueueItemContentProps = HTMLAttributes<HTMLSpanElement>;

export const QueueItemContent = ({ className, ...props }: QueueItemContentProps) => (
  <span className={cn("line-clamp-2 grow break-words", className)} {...props} />
);
