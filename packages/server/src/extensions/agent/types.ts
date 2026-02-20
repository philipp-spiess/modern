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
}

export interface AgentThreadViewState extends AgentThreadMetaState {
  threadPath: string;
  messages: AgentThreadMessages;
  streamMessage: AgentThreadStreamMessage;
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
