import { File, PatchDiff, WorkerPoolContextProvider } from "@pierre/diffs/react";
import type {
  AssistantMessage,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";
import type { AgentThreadMessages, AgentThreadStreamMessage } from "@diffs-io/server/src/extensions/agent/types";
import { Compass, FilePlus, FileText, ListPlus, Pencil, Terminal as TerminalIcon, User } from "lucide-react";
import { Component, type ReactNode, memo } from "react";

import { Message, MessageContent, MessageResponse } from "./components/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "./components/reasoning";
import { Terminal } from "./components/terminal";
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
        workerFactory: () =>
          new Worker(new URL("@pierre/diffs/worker/worker.js", import.meta.url), { type: "module" }),
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
          <MessageView key={i} message={msg} resultMap={resultMap} isStreamingMsg={false} />
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
    case "glob":
    case "grep":
    case "list":
      return <SearchToolView toolName={toolName} args={args} result={result} status={status} />;
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
                diffStyle: "unified",
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
// Tool: bash (AI Elements Tool + Terminal)
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
    <Tool defaultOpen={false}>
      <ToolHeader
        icon={<TerminalIcon className="size-3.5 text-white/50" />}
        title={command ? truncate(command, 80) : "bash"}
        status={status}
      />
      {hasOutput && (
        <ToolContent>
          <Terminal output={output!} />
        </ToolContent>
      )}
    </Tool>
  );
}

// ---------------------------------------------------------------------------
// Tool: glob/grep/list (AI Elements Tool)
// ---------------------------------------------------------------------------

function SearchToolView({
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
  const title =
    toolName === "grep"
      ? `grep ${args.pattern ?? ""}`
      : toolName === "glob"
        ? `glob ${args.pattern ?? ""}`
        : `ls ${args.path ?? ""}`;

  return (
    <Tool defaultOpen={false}>
      <ToolHeader
        icon={<FileText className="size-3.5 text-white/40" />}
        title={truncate(String(title), 80)}
        status={status}
      />
      {output && (
        <ToolContent>
          <Terminal output={output} />
        </ToolContent>
      )}
    </Tool>
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
  const status = message.exitCode === 0 || message.exitCode === undefined ? "success" : "error";

  return (
    <Tool defaultOpen={false}>
      <ToolHeader
        icon={<TerminalIcon className="size-3.5 text-white/50" />}
        title={truncate(message.command, 80)}
        status={status}
        statusText={message.cancelled ? "Cancelled" : message.exitCode ? `Exit ${message.exitCode}` : undefined}
      />
      {hasOutput && (
        <ToolContent>
          <Terminal output={message.output + (message.truncated ? "\n… (output truncated)" : "")} />
        </ToolContent>
      )}
    </Tool>
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
