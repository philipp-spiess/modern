import { File, PatchDiff, WorkerPoolContextProvider } from "@pierre/diffs/react";
import type {
  AssistantMessage,
  ImageContent,
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
  ChevronRightIcon,
  FileText,
  GlobeIcon,
  ListPlus,
  Pencil,
  Terminal as TerminalIcon,
  WrenchIcon,
} from "lucide-react";
import { Component, type ReactNode, memo, useCallback, useEffect, useRef } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { AnsiOutput, containsAnsi } from "./components/ansi-output";
import { useDiffStyle } from "./diff-style-context";
import { isExploreCommand } from "./explore-command";

import { Message, MessageContent, MessageResponse } from "./components/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "./components/reasoning";
import { Shimmer } from "./components/shimmer";

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

  // Group consecutive explore-only assistant messages across the message list
  type ListEntry = { kind: "message"; message: AnyMessage } | { kind: "exploreGroup"; calls: ToolCall[] };
  const entries: ListEntry[] = [];

  for (const msg of visibleMessages) {
    if (msg.role === "assistant" && isExploreOnlyAssistant(msg as AssistantMessage)) {
      const calls = (msg as AssistantMessage).content.filter((b): b is ToolCall => b.type === "toolCall");
      const last = entries[entries.length - 1];
      if (last?.kind === "exploreGroup") {
        last.calls.push(...calls);
      } else {
        entries.push({ kind: "exploreGroup", calls });
      }
    } else {
      entries.push({ kind: "message", message: msg });
    }
  }

  // Merge streaming message into the last explore group if applicable
  let streamConsumed = false;
  if (streamMessage?.role === "assistant" && isExploreOnlyAssistant(streamMessage as AssistantMessage)) {
    const calls = (streamMessage as AssistantMessage).content.filter((b): b is ToolCall => b.type === "toolCall");
    if (calls.length > 0) {
      const last = entries[entries.length - 1];
      if (last?.kind === "exploreGroup") {
        last.calls.push(...calls);
      } else {
        entries.push({ kind: "exploreGroup", calls });
      }
      streamConsumed = true;
    }
  }

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
        {entries.map((entry, i) =>
          entry.kind === "exploreGroup" ? (
            <ExploreGroupView
              key={i}
              calls={entry.calls}
              isActive={isStreaming && streamConsumed && i === entries.length - 1}
            />
          ) : (
            <div key={i} className="content-visibility-auto">
              <MessageView message={entry.message} resultMap={resultMap} isStreamingMsg={false} />
            </div>
          ),
        )}
        {streamMessage && !streamConsumed && (
          <MessageView message={streamMessage} resultMap={resultMap} isStreamingMsg={isStreaming} />
        )}
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

  const images =
    typeof message.content === "string" ? [] : message.content.filter((c): c is ImageContent => c.type === "image");

  return (
    <Message from="user" className="py-3">
      <MessageContent>
        <div className="min-w-0 leading-relaxed whitespace-pre-wrap">{text}</div>
        {images.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            {images.map((img, i) => (
              <img
                key={i}
                src={`data:${img.mimeType};base64,${img.data}`}
                alt="User attachment"
                className="max-h-96 rounded border border-white/10 object-contain"
              />
            ))}
          </div>
        )}
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

  // Group consecutive explore-type tool calls (read, web_search, explore bash)
  type RenderBlock = MergedBlock | { kind: "exploreGroup"; calls: ToolCall[] };
  const renderBlocks: RenderBlock[] = [];

  for (const item of merged) {
    if (item.kind === "toolCall" && isExploreTool(item.call)) {
      const last = renderBlocks[renderBlocks.length - 1];
      if (last?.kind === "exploreGroup") {
        last.calls.push(item.call);
      } else {
        renderBlocks.push({ kind: "exploreGroup", calls: [item.call] });
      }
    } else if (
      renderBlocks[renderBlocks.length - 1]?.kind === "exploreGroup" &&
      ((item.kind === "text" && !item.text.trim()) || item.kind === "thinking")
    ) {
      // Skip empty text and thinking blocks between explore tools so they stay grouped
    } else {
      renderBlocks.push(item);
    }
  }

  const hasExploreGroup = renderBlocks.some((b) => b.kind === "exploreGroup");

  return (
    <Message from="assistant" className="py-2">
      <MessageContent className={hasExploreGroup ? "w-full!" : undefined}>
        {renderBlocks.map((item, i) => {
          if (item.kind === "thinking") {
            const isLastBlock = isStreaming && i === renderBlocks.length - 1;
            if (!isLastBlock) return null;
            return <ThinkingView key={i} content={item.content} isStreaming={isStreaming} />;
          }
          if (item.kind === "text") {
            return (
              <div key={i} className="prose-agent min-w-0">
                <MessageResponse isAnimating={isStreaming}>{item.text}</MessageResponse>
              </div>
            );
          }
          if (item.kind === "exploreGroup") {
            return (
              <ExploreGroupView key={i} calls={item.calls} isActive={isStreaming && i === renderBlocks.length - 1} />
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
    <Reasoning isStreaming={isStreaming} defaultOpen={false}>
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
      return <WriteToolView path={args.path} content={args.content} status={status} />;
    case "read":
      return <ReadToolView path={args.path} result={result} status={status} />;
    case "edit":
      return (
        <EditToolView path={args.path} oldText={args.oldText} newText={args.newText} result={result} status={status} />
      );
    case "bash":
      return <BashToolView command={args.command} result={result} status={status} />;
    case "web_search":
      return <GenericToolView toolName="WebSearch" icon={GlobeIcon} args={args} result={result} status={status} />;
    default:
      return <GenericToolView toolName={toolName} args={args} result={result} status={status} />;
  }
}

// ---------------------------------------------------------------------------
// Explore group: collapsed summary of consecutive read/search/explore tools
// ---------------------------------------------------------------------------

function describeExploreTool(call: ToolCall): string {
  const args = call.arguments ?? {};

  if (call.name === "read") {
    const path = String(args.path ?? "file");
    return `Read ${path.split("/").pop()}`;
  }

  if (call.name === "web_search") {
    const queries = args.search_queries as string[] | undefined;
    if (queries?.length) return `Searched web for "${queries[0]}"`;
    const objective = args.objective as string | undefined;
    if (objective) return `Searched web: ${objective}`;
    return "Web search";
  }

  // Bash explore – try to extract a nice description for search commands
  const command = String(args.command ?? "");
  const trimmed = command.trimStart();
  const firstWord = trimmed.split(/[\s]/)[0];
  const searchCmds = new Set(["grep", "egrep", "fgrep", "rg", "ag", "ack", "ast-grep", "sg"]);
  if (searchCmds.has(firstWord)) {
    const quotedMatch = command.match(/['"]([^'"]+)['"]/);
    if (quotedMatch) {
      const pattern = quotedMatch[1];
      const afterPattern = command.slice(command.indexOf(quotedMatch[0]) + quotedMatch[0].length).trim();
      const pathArgs = afterPattern.split(/\s+/).filter((a) => !a.startsWith("-") && a.length > 0);
      const searchPath = pathArgs[pathArgs.length - 1];
      return searchPath ? `Searched for ${pattern} in ${searchPath}` : `Searched for ${pattern}`;
    }
  }
  return command;
}

function ExploreGroupView({ calls, isActive }: { calls: ToolCall[]; isActive: boolean }) {
  let files = 0;
  let searches = 0;
  for (const call of calls) {
    if (call.name === "read") files++;
    else searches++;
  }

  const parts: string[] = [];
  if (files > 0) parts.push(`${files} ${files === 1 ? "file" : "files"}`);
  if (searches > 0) parts.push(`${searches} ${searches === 1 ? "search" : "searches"}`);
  const summary = `Explored ${parts.join(", ")}`;

  return (
    <Collapsible className="group/explore not-prose w-full">
      <CollapsibleTrigger className="group/trigger flex w-full items-center gap-1.5 py-1 text-left">
        {isActive ? (
          <Shimmer as="span" className="text-sm font-medium">
            {summary}
          </Shimmer>
        ) : (
          <span className="text-sm font-medium text-white/50">{summary}</span>
        )}
        <ChevronRightIcon className="size-3 text-white/30 opacity-0 transition-all group-hover/trigger:opacity-100 group-data-[state=open]/explore:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col">
          {calls.map((call, i) => (
            <span key={i} className="text-sm text-white/40">
              {describeExploreTool(call)}
            </span>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Tool: write (AI Elements Tool + @pierre/diffs File)
// ---------------------------------------------------------------------------

function WriteToolView({
  path,
  content,
  status,
}: {
  path?: string;
  content?: string;
  status: "pending" | "success" | "error";
}) {
  const fileName = path?.split("/").pop() ?? "unknown";
  const filePath = path?.replace(/^\.\//, "") ?? "";
  const lineCount = content ? content.split("\n").length : 0;

  return (
    <Collapsible
      defaultOpen
      className="group not-prose relative w-full rounded-lg border border-white/8 transition-colors hover:border-white/10"
    >
      {status === "pending" && <BorderBeam />}
      <CollapsibleTrigger className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/[0.02]">
        <Pencil
          className={cn("size-3.5 shrink-0", status === "pending" ? "animate-pulse text-white/40" : "text-white/50")}
        />
        <span className="shrink-0 text-xs font-medium text-white/70">Write</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-white/30">{filePath}</span>
        {lineCount > 0 && status !== "error" && (
          <span className="shrink-0 text-xs text-emerald-400/70">+{lineCount}</span>
        )}
        {status === "error" && (
          <span className="shrink-0 rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-medium text-red-400">
            Error
          </span>
        )}
        <ChevronDownIcon className="size-3.5 shrink-0 text-white/20 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {content && (
          <div className="border-t border-white/5">
            <DiffErrorBoundary fallback={<pre className="overflow-x-auto p-3 text-xs text-white/50">{content}</pre>}>
              <File
                file={{ name: fileName, contents: content }}
                options={{ theme: "vitesse-dark", overflow: "wrap", disableFileHeader: true, unsafeCSS: DIFFS_CSS }}
              />
            </DiffErrorBoundary>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
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
  const filePath = path?.replace(/^\.\//, "") ?? "";
  const content = getResultText(result);
  const images = getResultImages(result);
  const lineCount = content ? content.split("\n").length : 0;
  const hasImages = images.length > 0;

  return (
    <Collapsible
      defaultOpen={false}
      className="group not-prose relative w-full rounded-lg border border-white/8 transition-colors hover:border-white/10"
    >
      {status === "pending" && <BorderBeam />}
      <CollapsibleTrigger className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/[0.02]">
        <FileText
          className={cn("size-3.5 shrink-0", status === "pending" ? "animate-pulse text-white/40" : "text-white/50")}
        />
        <span className="shrink-0 text-xs font-medium text-white/70">Read</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-white/30">{filePath}</span>
        {lineCount > 0 && !hasImages && status !== "error" && (
          <span className="shrink-0 text-xs text-white/25">{lineCount} lines</span>
        )}
        {hasImages && <span className="shrink-0 text-xs text-white/25">{images[0].mimeType}</span>}
        {status === "error" && (
          <span className="shrink-0 rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-medium text-red-400">
            Error
          </span>
        )}
        <ChevronDownIcon className="size-3.5 shrink-0 text-white/20 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {content && (
          <div className="border-t border-white/5">
            <DiffErrorBoundary fallback={<pre className="overflow-x-auto p-3 text-xs text-white/50">{content}</pre>}>
              <File
                file={{ name: fileName, contents: content }}
                options={{ theme: "vitesse-dark", overflow: "wrap", disableFileHeader: true, unsafeCSS: DIFFS_CSS }}
              />
            </DiffErrorBoundary>
          </div>
        )}
      </CollapsibleContent>
      <ResultImages images={images} fileName={fileName} />
    </Collapsible>
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
  const filePath = path?.replace(/^\.\//, "") ?? "";
  const diffStyle = useDiffStyle();
  const diff = result?.details?.diff as string | undefined;
  const patch = diff
    ? convertToPatchFormat(fileName, diff, result?.details?.firstChangedLine ?? 1)
    : oldText && newText
      ? buildSimpleDiff(oldText, newText)
      : null;

  // Compute diff stats from the raw diff or patch
  const diffSource = diff ?? patch ?? "";
  const added = (diffSource.match(/^\+[^+]/gm) || []).length;
  const removed = (diffSource.match(/^-[^-]/gm) || []).length;

  return (
    <Collapsible
      defaultOpen
      className="group not-prose relative w-full rounded-lg border border-white/8 transition-colors hover:border-white/10"
    >
      {status === "pending" && <BorderBeam />}
      <CollapsibleTrigger className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/[0.02]">
        <Pencil
          className={cn("size-3.5 shrink-0", status === "pending" ? "animate-pulse text-white/40" : "text-white/50")}
        />
        <span className="shrink-0 text-xs font-medium text-white/70">Edit</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-white/30">{filePath}</span>
        {(added > 0 || removed > 0) && status !== "error" && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs">
            {added > 0 && <span className="text-emerald-400/70">+{added}</span>}
            {removed > 0 && <span className="text-red-400/70">-{removed}</span>}
          </span>
        )}
        {status === "error" && (
          <span className="shrink-0 rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-medium text-red-400">
            Error
          </span>
        )}
        <ChevronDownIcon className="size-3.5 shrink-0 text-white/20 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {patch && (
          <div className="border-t border-white/5">
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
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
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

function isExploreTool(call: ToolCall): boolean {
  if (call.name === "read") return true;
  if (call.name === "web_search") return true;
  if (call.name === "bash") {
    const command = call.arguments?.command;
    return typeof command === "string" && isExploreCommand(command);
  }
  return false;
}

function isExploreOnlyAssistant(msg: AssistantMessage): boolean {
  const toolCalls = msg.content.filter((b): b is ToolCall => b.type === "toolCall");
  if (toolCalls.length === 0) return false;
  if (!toolCalls.every((c) => isExploreTool(c))) return false;
  return !msg.content.some((b) => b.type === "text" && b.text.trim());
}

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
  const explore = Boolean(command && isExploreCommand(command));
  const Icon = explore ? Compass : TerminalIcon;
  const label = explore ? "Explore" : "Bash";

  return (
    <Collapsible
      defaultOpen={false}
      className="group not-prose relative w-full rounded-lg border border-white/8 transition-colors hover:border-white/10"
    >
      {status === "pending" && <BorderBeam />}
      <CollapsibleTrigger className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/[0.02]">
        <Icon
          className={cn("size-3.5 shrink-0", status === "pending" ? "animate-pulse text-white/40" : "text-white/50")}
        />
        <span className="shrink-0 text-xs font-medium text-white/70">{label}</span>
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
  icon: Icon = WrenchIcon,
  args,
  result,
  status,
}: {
  toolName: string;
  icon?: React.ComponentType<{ className?: string }>;
  args: Record<string, unknown>;
  result?: ToolResultMessage;
  status: "pending" | "success" | "error";
}) {
  const output = getResultText(result);
  const images = getResultImages(result);
  const preview = Object.values(args).find((v) => typeof v === "string") as string | undefined;

  return (
    <Collapsible
      defaultOpen={false}
      className="group not-prose relative w-full rounded-lg border border-white/8 transition-colors hover:border-white/10"
    >
      {status === "pending" && <BorderBeam />}
      <CollapsibleTrigger className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/[0.02]">
        <Icon
          className={cn("size-3.5 shrink-0", status === "pending" ? "animate-pulse text-white/40" : "text-white/50")}
        />
        <span className="shrink-0 text-xs font-medium text-white/70">{toolName}</span>
        {preview && <span className="min-w-0 flex-1 truncate font-mono text-xs text-white/30">{preview}</span>}
        {status === "error" && (
          <span className="shrink-0 rounded bg-red-500/15 px-1.5 py-0.5 text-[11px] font-medium text-red-400">
            Error
          </span>
        )}
        <ChevronDownIcon className="size-3.5 shrink-0 text-white/20 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="max-h-64 overflow-auto border-t border-white/5 p-3 text-xs text-white/50">
          {Object.keys(args).length > 0 && (
            <pre className="mb-2 whitespace-pre-wrap break-all">{JSON.stringify(args, null, 2)}</pre>
          )}
          {output && <pre className="whitespace-pre-wrap break-all">{output}</pre>}
        </div>
        <ResultImages images={images} />
      </CollapsibleContent>
    </Collapsible>
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

function getResultImages(result?: ToolResultMessage): ImageContent[] {
  if (!result) return [];
  return result.content.filter((c): c is ImageContent => c.type === "image");
}

function ResultImages({ images, fileName }: { images: ImageContent[]; fileName?: string }) {
  const openImageWindow = useCallback(
    (img: ImageContent) => {
      import("@tauri-apps/api/webviewWindow").then(({ WebviewWindow }) => {
        const label = `image-${Date.now()}`;
        const dataUri = `data:${img.mimeType};base64,${img.data}`;
        const html = `<!doctype html><html><head><style>*{margin:0;padding:0}html,body{background:#000;height:100%;overflow:hidden}img{width:100%;height:100%;object-fit:contain}</style></head><body><img src="${dataUri}"/></body></html>`;
        const blob = new Blob([html], { type: "text/html" });
        const url = URL.createObjectURL(blob);

        // Size window to image aspect ratio, capped at 1400 wide
        const tempImg = new Image();
        tempImg.onload = () => {
          const maxW = 1400;
          const ratio = tempImg.naturalHeight / tempImg.naturalWidth;
          const w = Math.min(tempImg.naturalWidth, maxW);
          const h = Math.round(w * ratio) + 32;
          new WebviewWindow(label, {
            url,
            title: fileName ?? "Image Preview",
            width: w,
            height: h,
            center: true,
            decorations: true,
          });
        };
        tempImg.src = dataUri;
      });
    },
    [fileName],
  );

  if (images.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 p-1 pt-0">
      {images.map((img, i) => (
        <img
          key={i}
          src={`data:${img.mimeType};base64,${img.data}`}
          alt="Tool result"
          className="cursor-pointer rounded-sm transition-opacity hover:opacity-80"
          onClick={() => openImageWindow(img)}
        />
      ))}
    </div>
  );
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
