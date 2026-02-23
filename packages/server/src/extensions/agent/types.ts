import type { AgentSession, AgentSessionEvent } from "@mariozechner/pi-coding-agent";

export type AgentThreadMessages = AgentSession["messages"];
export type AgentThreadStreamMessage = AgentSession["state"]["streamMessage"];
export type AgentThreadThinkingLevel = AgentSession["thinkingLevel"];

export interface AgentThreadModelSummary {
  provider: string;
  id: string;
  name: string;
}

export interface AgentThreadMetaState {
  isStreaming: boolean;
  steeringQueue: string[];
  followUpQueue: string[];
  steeringMode: AgentSession["steeringMode"];
  followUpMode: AgentSession["followUpMode"];
  model: AgentThreadModelSummary | null;
  thinkingLevel: AgentThreadThinkingLevel;
  supportsThinking: boolean;
  availableThinkingLevels: string[];
}

export interface AvailableModelInfo {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
}

export interface AgentThreadViewState extends AgentThreadMetaState {
  threadPath: string;
  messages: AgentThreadMessages;
  streamMessage: AgentThreadStreamMessage;
}

/**
 * Incremental message sync payload, included on checkpoint events.
 *
 * `fromIndex` is the boundary: the client keeps its first `fromIndex` messages
 * untouched and replaces everything from that point onward with `messages`.
 *
 * - Normal checkpoint: `fromIndex = snapshotMessageCount`, carries only new messages.
 * - Full reset (compaction): `fromIndex = 0`, carries the entire message list.
 */
export interface AgentThreadMessageTail {
  fromIndex: number;
  messages: AgentThreadMessages;
}

export type AgentThreadWatchUpdate =
  | {
      kind: "snapshot";
      seq: number;
      state: AgentThreadViewState;
    }
  | {
      kind: "event";
      seq: number;
      event: AgentSessionEvent;
      meta: AgentThreadMetaState;
      /** Authoritative message tail from the server, included on checkpoint events. */
      messageTail?: AgentThreadMessageTail;
      /** Authoritative stream message from the server, included on checkpoint events to clear stale streams. */
      streamMessage?: AgentThreadStreamMessage | null;
    };

export type AgentThreadDeliveryMode = "auto" | "steer" | "followUp";

export interface AgentThreadSendResult {
  delivery: "prompt" | "steer" | "followUp";
  meta: AgentThreadMetaState;
}

export interface AgentThreadAbortResult {
  cleared: {
    steering: string[];
    followUp: string[];
  };
  meta: AgentThreadMetaState;
}
