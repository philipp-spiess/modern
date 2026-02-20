import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";
import { TerminalIcon } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface TerminalContextType {
  output: string;
  isStreaming: boolean;
  autoScroll: boolean;
}

const TerminalContext = createContext<TerminalContextType>({
  autoScroll: true,
  isStreaming: false,
  output: "",
});

// ---------------------------------------------------------------------------
// Terminal container
// ---------------------------------------------------------------------------

export type TerminalProps = HTMLAttributes<HTMLDivElement> & {
  output: string;
  isStreaming?: boolean;
  autoScroll?: boolean;
};

export const Terminal = ({
  output,
  isStreaming = false,
  autoScroll = true,
  className,
  children,
  ...props
}: TerminalProps) => {
  const contextValue = useMemo(() => ({ autoScroll, isStreaming, output }), [autoScroll, isStreaming, output]);

  return (
    <TerminalContext.Provider value={contextValue}>
      <div className={cn("flex flex-col overflow-hidden rounded-b-lg bg-black/30", className)} {...props}>
        {children ?? (
          <>
            <TerminalHeader />
            <TerminalContent />
          </>
        )}
      </div>
    </TerminalContext.Provider>
  );
};

// ---------------------------------------------------------------------------
// Terminal header
// ---------------------------------------------------------------------------

export type TerminalHeaderProps = HTMLAttributes<HTMLDivElement>;

export const TerminalHeader = ({ className, children, ...props }: TerminalHeaderProps) => (
  <div
    className={cn("flex items-center gap-2 border-b border-white/5 px-3 py-1.5 text-[11px] text-white/30", className)}
    {...props}
  >
    {children ?? (
      <>
        <TerminalIcon className="size-3" />
        <span>Output</span>
      </>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// Terminal content
// ---------------------------------------------------------------------------

export type TerminalContentProps = HTMLAttributes<HTMLDivElement>;

export const TerminalContent = ({ className, children, ...props }: TerminalContentProps) => {
  const { output, isStreaming, autoScroll } = useContext(TerminalContext);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [output, autoScroll]);

  return (
    <div
      className={cn("max-h-64 overflow-auto p-3 font-mono text-xs leading-relaxed", className)}
      ref={containerRef}
      {...props}
    >
      {children ?? (
        <pre className="text-white/50 whitespace-pre-wrap break-all">
          {output}
          {isStreaming && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-white/60" />}
        </pre>
      )}
    </div>
  );
};
