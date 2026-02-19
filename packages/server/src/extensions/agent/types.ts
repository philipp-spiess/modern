import type { AgentSession, AgentSessionEvent } from "@mariozechner/pi-coding-agent";

export type AgentThreadMessages = AgentSession["messages"];
export type AgentThreadStreamMessage = AgentSession["state"]["streamMessage"];
export type AgentThreadThinkingLevel = AgentSession["thinkingLevel"];

export interface AgentThreadModelSummary {
  provider: string;
  id: string;
  name: string;
}

export interface AgentThreadViewState {
  threadPath: string;
  messages: AgentThreadMessages;
  streamMessage: AgentThreadStreamMessage;
  isStreaming: boolean;
  steeringQueue: string[];
  followUpQueue: string[];
  steeringMode: AgentSession["steeringMode"];
  followUpMode: AgentSession["followUpMode"];
  model: AgentThreadModelSummary | null;
  thinkingLevel: AgentThreadThinkingLevel;
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
      state: AgentThreadViewState;
    };

export type AgentThreadDeliveryMode = "auto" | "steer" | "followUp";

export interface AgentThreadSendResult {
  delivery: "prompt" | "steer" | "followUp";
  state: AgentThreadViewState;
}

export interface AgentThreadAbortResult {
  cleared: {
    steering: string[];
    followUp: string[];
  };
  state: AgentThreadViewState;
}
