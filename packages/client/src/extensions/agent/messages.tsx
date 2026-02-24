import { File, PatchDiff, WorkerPoolContextProvider } from "@pierre/diffs/react";
import type {
  AssistantMessage,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";
import type { AgentThreadMessages, AgentThreadStreamMessage } from "@moderndev/server/src/extensions/agent/types";
import {
  Compass,
  ChevronDownIcon,
  FilePlus,
  FileText,
  ListPlus,
  Pencil,
  Terminal as TerminalIcon,
  User,
} from "lucide-react";
import { Component, type ReactNode, memo, useEffect, useRef } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { AnsiOutput, containsAnsi } from "./components/ansi-output";
import { useDiffStyle } from "./diff-style-context";

import { Message, MessageContent, MessageResponse } from "./components/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "./components/reasoning";
import { Tool, ToolContent, ToolHeader } from "./components/tool";

// ---------------------------------------------------------------------------
// Local type definitions for custom pi-coding-agent message types
// ---------------------------------------------------------------------------

interface BashExecutionMessage {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
  timestamp: number;
  excludeFromContext?: boolean;
}

interface CustomMessage {
  role: "custom";
  customType: string;
  content: string | (TextContent | { type: "image"; data: string; mimeType: string })[];
  display: boolean;
  details?: unknown;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AnyMessage = AgentThreadMessages[number];

interface ToolResultLookup {
  get(toolCallId: string): ToolResultMessage | undefined;
}

// ---------------------------------------------------------------------------
// Entrypoint: render all messages
// ---------------------------------------------------------------------------

export const MessageList = memo(function MessageList({
  messages,
  streamMessage,
  isStreaming,
}: {
  messages: AgentThreadMessages;
  streamMessage: AgentThreadStreamMessage;
  isStreaming: boolean;
}) {
  const resultMap = new Map<string, ToolResultMessage>();
  for (const msg of messages) {
    if (msg.role === "toolResult") {
      resultMap.set(msg.toolCallId, msg);
    }
  }

  const visibleMessages = messages.filter((m) => m.role !== "toolResult");

  return (
    <WorkerPoolContextProvider
      poolOptions={{
        workerFactory: () => new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), { type: "module" }),
        poolSize: 4,
        totalASTLRUCacheSize: 100,
      }}
      highlighterOptions={{
        theme: "vitesse-dark",
        lineDiffType: "word-alt",
      }}
    >
      <div className="flex flex-col gap-1">
        {visibleMessages.map((msg, i) => (
          <div key={i} className="content-visibility-auto">
            <MessageView message={msg} resultMap={resultMap} isStreamingMsg={false} />
          </div>
        ))}
        {streamMessage && <MessageView message={streamMessage} resultMap={resultMap} isStreamingMsg={isStreaming} />}
      </div>
    </WorkerPoolContextProvider>
  );
});

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

function MessageView({
  message,
  resultMap,
  isStreamingMsg,
}: {
  message: AnyMessage;
  resultMap: ToolResultLookup;
  isStreamingMsg: boolean;
}) {
  const msg = message as AnyMessage;
  switch (msg.role) {
    case "user":
      return <UserMessageView message={msg as UserMessage} />;
    case "assistant":
      return (
        <AssistantMessageView message={msg as AssistantMessage} resultMap={resultMap} isStreaming={isStreamingMsg} />
      );
    case "toolResult":
      return null;
    case "bashExecution":
      return <BashExecutionView message={msg as unknown as BashExecutionMessage} />;
    case "custom":
      return <CustomMessageView message={msg as unknown as CustomMessage} />;
    case "branchSummary":
      return <BranchSummaryView />;
    case "compactionSummary":
      return <CompactionSummaryView />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// User message (AI Elements Message)
// ---------------------------------------------------------------------------

function UserMessageView({ message }: { message: UserMessage }) {
  const text =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((c): c is TextContent => c.type === "text")
          .map((c) => c.text)
          .join("\n");

  return (
    <Message from="user" className="py-3">
      <MessageContent>
        <div className="flex items-start gap-3">
          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10">
            <User className="size-3.5 text-white/70" />
          </div>
          <div className="min-w-0 flex-1 pt-0.5 leading-relaxed whitespace-pre-wrap">{text}</div>
        </div>
      </MessageContent>
    </Message>
  );
}

// ---------------------------------------------------------------------------
// Assistant message (AI Elements Message + MessageResponse)
// ---------------------------------------------------------------------------

function AssistantMessageView({
  message,
  resultMap,
  isStreaming,
}: {
  message: AssistantMessage;
  resultMap: ToolResultLookup;
  isStreaming: boolean;
}) {
  const blocks = message.content;

  type MergedBlock =
    | { kind: "text"; text: string }
    | { kind: "thinking"; content: ThinkingContent }
    | { kind: "toolCall"; call: ToolCall };

  const merged: MergedBlock[] = [];

  for (const block of blocks) {
    if (block.type === "text") {
      const last = merged[merged.length - 1];
      if (last?.kind === "text") {
        last.text += block.text;
      } else {
        merged.push({ kind: "text", text: block.text });
      }
    } else if (block.type === "thinking") {
      merged.push({ kind: "thinking", content: block });
    } else if (block.type === "toolCall") {
      merged.push({ kind: "toolCall", call: block });
    }
  }

  return (
    <Message from="assistant" className="py-2">
      <MessageContent>
        {merged.map((item, i) => {
          if (item.kind === "thinking") {
            return <ThinkingView key={i} content={item.content} isStreaming={isStreaming} />;
          }
          if (item.kind === "text") {
            return (
              <div key={i} className="prose-agent min-w-0">
                <MessageResponse isAnimating={isStreaming}>{item.text}</MessageResponse>
              </div>
            );
          }
          if (item.kind === "toolCall") {
            const result = resultMap.get(item.call.id);
            return <ToolCallView key={i} call={item.call} result={result} />;
          }
          return null;
        })}
      </MessageContent>
    </Message>
  );
}

// ---------------------------------------------------------------------------
// Thinking block (AI Elements Reasoning)
// ---------------------------------------------------------------------------

function ThinkingView({ content, isStreaming }: { content: ThinkingContent; isStreaming: boolean }) {
  if (!content.thinking.trim()) return null;

  return (
    <Reasoning isStreaming={isStreaming}>
      <ReasoningTrigger />
      <ReasoningContent>{content.thinking}</ReasoningContent>
    </Reasoning>
  );
}

// ---------------------------------------------------------------------------
// Tool call + result router (AI Elements Tool)
// ---------------------------------------------------------------------------

function ToolCallView({ call, result }: { call: ToolCall; result?: ToolResultMessage }) {
  const args = call.arguments ?? {};
  const toolName = call.name;
  const isError = result?.isError ?? false;
  const isPending = !result;
  const status = isPending ? "pending" : isError ? "error" : "success";

  switch (toolName) {
    case "write":
      return <WriteToolView path={args.path} content={args.content} result={result} status={status} />;
    case "read":
      return <ReadToolView path={args.path} result={result} status={status} />;
    case "edit":
      return (
        <EditToolView path={args.path} oldText={args.oldText} newText={args.newText} result={result} status={status} />
      );
    case "bash":
      return <BashToolView command={args.command} result={result} status={status} />;
    default:
      return <GenericToolView toolName={toolName} args={args} result={result} status={status} />;
  }
}

// ---------------------------------------------------------------------------
// Tool: write (AI Elements Tool + @pierre/diffs File)
// ---------------------------------------------------------------------------

function WriteToolView({
  path,
  content,
  result,
  status,
}: {
  path?: string;
  content?: string;
  result?: ToolResultMessage;
  status: "pending" | "success" | "error";
}) {
  const fileName = path?.split("/").pop() ?? "unknown";

  return (
    <Tool>
      <ToolHeader
        icon={<FilePlus className="size-3.5 text-emerald-400" />}
        title={fileName}
        status={status}
        statusText={getResultText(result) ? truncate(getResultText(result)!, 40) : undefined}
      />
      <ToolContent>
        {content && (
          <DiffErrorBoundary fallback={<pre className="overflow-x-auto p-3 text-xs text-white/50">{content}</pre>}>
            <File
              file={{ name: fileName, contents: content }}
              options={{ theme: "vitesse-dark", overflow: "scroll", disableFileHeader: true, unsafeCSS: DIFFS_CSS }}
            />
          </DiffErrorBoundary>
        )}
      </ToolContent>
    </Tool>
  );
}

// ---------------------------------------------------------------------------
// Tool: read (AI Elements Tool + @pierre/diffs File)
// ---------------------------------------------------------------------------

function ReadToolView({
  path,
  result,
  status,
}: {
  path?: string;
  result?: ToolResultMessage;
  status: "pending" | "success" | "error";
}) {
  const fileName = path?.split("/").pop() ?? "unknown";
  const content = getResultText(result);

  return (
    <Tool>
      <ToolHeader icon={<FileText className="size-3.5 text-blue-400" />} title={fileName} status={status} />
      <ToolContent>
        {content && (
          <DiffErrorBoundary fallback={<pre className="overflow-x-auto p-3 text-xs text-white/50">{content}</pre>}>
            <File
              file={{ name: fileName, contents: content }}
              options={{ theme: "vitesse-dark", overflow: "scroll", disableFileHeader: true, unsafeCSS: DIFFS_CSS }}
            />
          </DiffErrorBoundary>
        )}
      </ToolContent>
    </Tool>
  );
}

// ---------------------------------------------------------------------------
// Tool: edit (AI Elements Tool + @pierre/diffs PatchDiff)
// ---------------------------------------------------------------------------

function EditToolView({
  path,
  oldText,
  newText,
  result,
  status,
}: {
  path?: string;
  oldText?: string;
  newText?: string;
  result?: ToolResultMessage;
  status: "pending" | "success" | "error";
}) {
  const fileName = path?.split("/").pop() ?? "unknown";
  const diffStyle = useDiffStyle();
  const diff = result?.details?.diff as string | undefined;
  const patch = diff
    ? convertToPatchFormat(fileName, diff, result?.details?.firstChangedLine ?? 1)
    : oldText && newText
      ? buildSimpleDiff(oldText, newText)
      : null;

  return (
    <Tool defaultOpen>
      <ToolHeader icon={<Pencil className="size-3.5 text-amber-400" />} title={fileName} status={status} />
      <ToolContent>
        {patch && (
          <DiffErrorBoundary
            fallback={
              <pre className="overflow-x-auto p-3 text-xs text-white/50">{diff ?? `${oldText}\n→\n${newText}`}</pre>
            }
          >
            <PatchDiff
              patch={patch}
              options={{
                theme: "vitesse-dark",
                diffStyle,
                diffIndicators: "bars",
                lineDiffType: "word-alt",
                disableFileHeader: true,
                overflow: "scroll",
                unsafeCSS: DIFFS_PATCH_CSS,
              }}
            />
          </DiffErrorBoundary>
        )}
      </ToolContent>
    </Tool>
  );
}

// ---------------------------------------------------------------------------
// Helpers: Syntax-highlighted code block & shell output with diff detection
// ---------------------------------------------------------------------------

function InlineCodeBlock({ content, language }: { content: string; language: string }) {
  const filename = language === "bash" || language === "shell" ? "command.sh" : `file.${language}`;
  return (
    <DiffErrorBoundary
      fallback={<pre className="overflow-x-auto p-3 text-xs whitespace-pre-wrap text-white/50">{content}</pre>}
    >
      <File
        file={{ name: filename, contents: content }}
        options={{
          theme: "vitesse-dark",
          overflow: "wrap",
          disableFileHeader: true,
          disableLineNumbers: true,
          unsafeCSS: DIFFS_CSS,
        }}
      />
    </DiffErrorBoundary>
  );
}

type OutputSegment = { type: "text" | "diff"; content: string };

function splitShellOutput(content: string): OutputSegment[] {
  const segments: OutputSegment[] = [];
  const lines = content.split("\n");
  let currentSegment: OutputSegment | null = null;
  let inDiff = false;

  for (const line of lines) {
    const isDiffStart = line.startsWith("diff --git ");
    const isDiffLine =
      inDiff &&
      (line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line.startsWith("@@ ") ||
        line.startsWith("+") ||
        line.startsWith("-") ||
        line.startsWith(" ") ||
        line === "");
    const isExitingDiff = inDiff && !isDiffStart && !isDiffLine && line.trim() !== "";

    if (isDiffStart) {
      if (currentSegment?.content) segments.push(currentSegment);
      currentSegment = { type: "diff", content: line };
      inDiff = true;
    } else if (isExitingDiff) {
      if (currentSegment?.content) segments.push(currentSegment);
      currentSegment = { type: "text", content: line };
      inDiff = false;
    } else if (inDiff) {
      currentSegment!.content += "\n" + line;
    } else {
      if (!currentSegment || currentSegment.type !== "text") {
        if (currentSegment?.content) segments.push(currentSegment);
        currentSegment = { type: "text", content: line };
      } else {
        currentSegment.content += "\n" + line;
      }
    }
  }

  if (currentSegment?.content) segments.push(currentSegment);
  return segments;
}

function ShellOutputView({ content }: { content: string }) {
  // ANSI escape codes → render via Ghostty WASM parser
  if (containsAnsi(content)) {
    return <AnsiOutput content={content} />;
  }

  const segments = splitShellOutput(content);
  if (segments.every((s) => s.type === "text")) {
    return <InlineCodeBlock content={content} language="txt" />;
  }
  return (
    <>
      {segments.map((segment, i) => (
        <InlineCodeBlock key={i} content={segment.content} language={segment.type === "diff" ? "diff" : "txt"} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tool: bash (custom collapsible with syntax-highlighted command & output)
// ---------------------------------------------------------------------------

function BashToolView({
  command,
  result,
  status,
}: {
  command?: string;
  result?: ToolResultMessage;
  status: "pending" | "success" | "error";
}) {
  const output = getResultText(result);
  const hasOutput = Boolean(output && output !== "(no output)");

  return (
    <Collapsible
      defaultOpen={false}
      className="group not-prose relative w-full rounded-lg border border-white/8 transition-colors hover:border-white/10"
    >
      {status === "pending" && <BorderBeam />}
      <CollapsibleTrigger className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/[0.02]">
        <TerminalIcon
          className={cn("size-3.5 shrink-0", status === "pending" ? "animate-pulse text-white/40" : "text-white/50")}
        />
        <span className="shrink-0 text-xs font-medium text-white/70">Bash</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-white/30">{command ?? ""}</span>
        {status === "error" && (
          <span className="shrink-0 rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-medium text-red-400">
            Error
          </span>
        )}
        <ChevronDownIcon className="size-3.5 shrink-0 text-white/20 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col">
          {command && (
            <div className="border-t border-white/5">
              <InlineCodeBlock content={command} language="bash" />
            </div>
          )}
          {hasOutput && (
            <div className="max-h-64 overflow-auto border-t border-white/5">
              <ShellOutputView content={output!} />
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Generic tool fallback (AI Elements Tool)
// ---------------------------------------------------------------------------

function GenericToolView({
  toolName,
  args,
  result,
  status,
}: {
  toolName: string;
  args: Record<string, unknown>;
  result?: ToolResultMessage;
  status: "pending" | "success" | "error";
}) {
  const output = getResultText(result);

  return (
    <Tool defaultOpen={false}>
      <ToolHeader title={toolName} status={status} />
      <ToolContent>
        <div className="max-h-64 overflow-auto p-3 text-xs text-white/50">
          {Object.keys(args).length > 0 && (
            <pre className="mb-2 whitespace-pre-wrap break-all">{JSON.stringify(args, null, 2)}</pre>
          )}
          {output && <pre className="whitespace-pre-wrap break-all">{output}</pre>}
        </div>
      </ToolContent>
    </Tool>
  );
}

// ---------------------------------------------------------------------------
// Bash execution message (custom message type, rendered as Tool + Terminal)
// ---------------------------------------------------------------------------

function BashExecutionView({ message }: { message: BashExecutionMessage }) {
  const hasOutput = message.output.trim().length > 0;
  const isError = message.exitCode !== 0 && message.exitCode !== undefined;
  const fullOutput = message.output + (message.truncated ? "\n… (output truncated)" : "");

  return (
    <Collapsible
      defaultOpen={false}
      className="group not-prose w-full overflow-hidden rounded-lg border border-white/8 transition-colors hover:border-white/10"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/[0.02]">
        <TerminalIcon className="size-3.5 shrink-0 text-white/50" />
        <span className="shrink-0 text-xs font-medium text-white/70">Bash</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-white/30">{message.command}</span>
        {message.cancelled && (
          <span className="shrink-0 rounded bg-yellow-500/15 px-1.5 py-0.5 text-[11px] font-medium text-yellow-400">
            Cancelled
          </span>
        )}
        {isError && !message.cancelled && (
          <span className="shrink-0 rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-medium text-red-400">
            Exit {message.exitCode}
          </span>
        )}
        <ChevronDownIcon className="size-3.5 shrink-0 text-white/20 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col">
          <div className="border-t border-white/5">
            <InlineCodeBlock content={message.command} language="bash" />
          </div>
          {hasOutput && (
            <div className="max-h-64 overflow-auto border-t border-white/5">
              <ShellOutputView content={fullOutput} />
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Custom / Branch / Compaction messages
// ---------------------------------------------------------------------------

function CustomMessageView({ message }: { message: CustomMessage }) {
  if (!message.display) return null;
  const text =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((c): c is TextContent => c.type === "text")
          .map((c) => c.text)
          .join("\n");

  return <div className="py-1 pl-1 text-xs text-white/40 italic">{text}</div>;
}

function BranchSummaryView() {
  return (
    <div className="flex items-center gap-2 py-2 pl-1 text-xs text-white/30">
      <div className="h-px flex-1 bg-white/10" />
      <span>Branch summary</span>
      <div className="h-px flex-1 bg-white/10" />
    </div>
  );
}

function CompactionSummaryView() {
  return (
    <div className="flex items-center gap-2 py-2 pl-1 text-xs text-white/30">
      <div className="h-px flex-1 bg-white/10" />
      <span>Context compacted</span>
      <div className="h-px flex-1 bg-white/10" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Queue indicators (rendered in message list when queues have items)
// ---------------------------------------------------------------------------

export function SteeringQueueIndicator({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex items-center gap-2 py-1 pl-1 text-xs text-amber-300/50">
      <Compass className="size-3" />
      <span>
        {items.length} steering {items.length === 1 ? "message" : "messages"} queued
      </span>
    </div>
  );
}

export function FollowUpQueueIndicator({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex items-center gap-2 py-1 pl-1 text-xs text-emerald-300/50">
      <ListPlus className="size-3" />
      <span>
        {items.length} follow-up{items.length === 1 ? "" : "s"} queued
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error boundary for @pierre/diffs components
// ---------------------------------------------------------------------------

class DiffErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// BorderBeam – animated rotating border for streaming state
// ---------------------------------------------------------------------------

function BorderBeam({ duration = 3, size = 60 }: { duration?: number; size?: number } = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const blobRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const blob = blobRef.current;
    if (!container || !blob) return;

    let frame: number;
    const start = performance.now();

    function tick(now: number) {
      const { width: w, height: h } = container!.getBoundingClientRect();
      const perimeter = 2 * (w + h);
      const t = (((now - start) / 1000 / duration) % 1) * perimeter;

      let x: number;
      let y: number;
      if (t < w) {
        x = t;
        y = 0;
      } else if (t < w + h) {
        x = w;
        y = t - w;
      } else if (t < 2 * w + h) {
        x = w - (t - w - h);
        y = h;
      } else {
        x = 0;
        y = h - (t - 2 * w - h);
      }

      blob!.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px)`;
      frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, size]);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-[-1px] z-10 rounded-[inherit]"
      style={{
        border: "1px solid transparent",
        WebkitMaskImage: "linear-gradient(#fff 0 0), linear-gradient(#fff 0 0)",
        WebkitMaskClip: "border-box, padding-box",
        WebkitMaskComposite: "destination-out",
        maskImage: "linear-gradient(#fff 0 0), linear-gradient(#fff 0 0)",
        maskClip: "border-box, padding-box",
        maskComposite: "exclude",
      }}
    >
      <div
        ref={blobRef}
        className="absolute left-0 top-0"
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,255,255,0.25) 0%, transparent 70%)",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DIFFS_CSS =
  ":host, [data-diffs], [data-line] { --diffs-bg: transparent; } pre { background: transparent !important; } [data-code] { padding-top: 0 !important; padding-bottom: 0 !important; }";

const DIFFS_PATCH_CSS =
  ":host, [data-diffs], [data-line], [data-column-number] { --diffs-bg: transparent; } [data-column-number] { border-right: none !important; } pre { background: transparent !important; }";

function getResultText(result?: ToolResultMessage): string | undefined {
  if (!result) return undefined;
  return result.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

function convertToPatchFormat(filePath: string, diff: string, lineOffset: number = 1): string {
  const lines = diff.split("\n");
  const diffLines: string[] = [];
  let additions = 0;
  let deletions = 0;
  let context = 0;

  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      diffLines.push(line);
      additions++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      diffLines.push(line);
      deletions++;
    } else if (line.startsWith(" ")) {
      diffLines.push(line);
      context++;
    } else if (line.length > 0 && !line.startsWith("@@") && !line.startsWith("---") && !line.startsWith("+++")) {
      diffLines.push(` ${line}`);
      context++;
    }
  }

  if (diffLines.length === 0) return "";

  const oldCount = deletions + context;
  const newCount = additions + context;
  const patchLines: string[] = [];
  const isNew = deletions === 0 && additions > 0;
  const isDelete = additions === 0 && deletions > 0;

  if (isNew) {
    patchLines.push("--- /dev/null");
    patchLines.push(`+++ b/${filePath}`);
    patchLines.push(`@@ -0,0 +${lineOffset},${newCount} @@`);
  } else if (isDelete) {
    patchLines.push(`--- a/${filePath}`);
    patchLines.push("+++ /dev/null");
    patchLines.push(`@@ -${lineOffset},${oldCount} +0,0 @@`);
  } else {
    patchLines.push(`--- a/${filePath}`);
    patchLines.push(`+++ b/${filePath}`);
    patchLines.push(`@@ -${lineOffset},${oldCount} +${lineOffset},${newCount} @@`);
  }

  patchLines.push(...diffLines);
  return patchLines.join("\n") + "\n";
}

function buildSimpleDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const patchLines = ["--- a/file", "+++ b/file", `@@ -1,${oldLines.length} +1,${newLines.length} @@`];
  for (const line of oldLines) patchLines.push(`-${line}`);
  for (const line of newLines) patchLines.push(`+${line}`);
  return patchLines.join("\n") + "\n";
}
