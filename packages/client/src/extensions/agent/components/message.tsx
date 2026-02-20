import type { ComponentProps, HTMLAttributes } from "react";

import { cn } from "@/lib/utils";
import { createCodePlugin } from "@streamdown/code";
import { cjk } from "@streamdown/cjk";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { memo } from "react";
import { Streamdown } from "streamdown";

// ---------------------------------------------------------------------------
// Message container
// ---------------------------------------------------------------------------

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: "user" | "assistant" | string;
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full flex-col gap-2",
      from === "user" ? "is-user ml-auto max-w-[95%] justify-end" : "is-assistant",
      className,
    )}
    {...props}
  />
);

// ---------------------------------------------------------------------------
// Message content wrapper
// ---------------------------------------------------------------------------

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
  <div
    className={cn(
      "flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-white/8 group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-white/90",
      "group-[.is-assistant]:text-white/85",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

// ---------------------------------------------------------------------------
// MessageResponse: Streamdown with AI Elements plugins
// ---------------------------------------------------------------------------

const codePlugin = createCodePlugin({ themes: ["vitesse-dark", "vitesse-dark"] });
const streamdownPlugins = { cjk, code: codePlugin, math, mermaid };

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      plugins={streamdownPlugins}
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children && prevProps.isAnimating === nextProps.isAnimating,
);
MessageResponse.displayName = "MessageResponse";
