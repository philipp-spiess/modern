import type { ComponentProps, ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { CheckCircleIcon, ChevronDownIcon, CircleAlert, ClockIcon, WrenchIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Tool container (collapsible)
// ---------------------------------------------------------------------------

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("group not-prose w-full overflow-hidden rounded-lg border border-white/8", className)}
    {...props}
  />
);

// ---------------------------------------------------------------------------
// Tool header
// ---------------------------------------------------------------------------

export type ToolStatus = "pending" | "success" | "error";

export type ToolHeaderProps = ComponentProps<typeof CollapsibleTrigger> & {
  title: string;
  icon?: ReactNode;
  status: ToolStatus;
  statusText?: string;
};

const statusIcons: Record<ToolStatus, ReactNode> = {
  pending: <ClockIcon className="size-3.5 animate-pulse text-white/40" />,
  success: <CheckCircleIcon className="size-3.5 text-emerald-400/60" />,
  error: <CircleAlert className="size-3.5 text-red-400" />,
};

const statusLabels: Record<ToolStatus, string> = {
  pending: "Running",
  success: "Done",
  error: "Error",
};

export const ToolHeader = ({ title, icon, status, statusText, className, ...props }: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      "flex w-full items-center gap-2 bg-white/[0.03] px-3 py-2 text-left transition-colors hover:bg-white/[0.06]",
      className,
    )}
    {...props}
  >
    {icon ?? <WrenchIcon className="size-3.5 text-white/40" />}
    <span className="min-w-0 flex-1 truncate text-xs font-medium text-white/80">{title}</span>
    <Badge variant="secondary" className="gap-1 border-white/8 bg-white/5 text-[11px] text-white/50">
      {statusIcons[status]}
      {statusText ?? statusLabels[status]}
    </Badge>
    <ChevronDownIcon className="size-3.5 text-white/30 transition-transform group-data-[state=open]:rotate-180" />
  </CollapsibleTrigger>
);

// ---------------------------------------------------------------------------
// Tool content
// ---------------------------------------------------------------------------

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent className={cn("overflow-hidden", className)} {...props} />
);
