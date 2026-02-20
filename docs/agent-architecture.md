# Agent Architecture (High-Level)

## Overview

The agent is a chat-based coding assistant built as a diffs extension. The LLM/tool implementation is being redone — this doc covers the extension shell, routing, and client layer that will stay.

## Flow

```
┌─────────────┐     RPC (oRPC)     ┌──────────────────┐
│  React UI   │ ◄────────────────► │   Agent Router    │
│  chat.tsx   │   chatStream       │   router.ts       │
└─────────────┘                    └────────┬─────────┘
                                            │
                                   ┌────────▼─────────┐
                                   │   Extension       │
                                   │   index.ts        │
                                   │   (panel mgmt,    │
                                   │    commands)       │
                                   └──────────────────┘
```

## Extension Entry (`extensions/agent/index.ts`)

Registers three commands and manages panel lifecycle:

- **`agent.openPanel`** — Creates or reopens a chat panel via `diffs.window.createReactPanel`. Tracks panels by `chatId` in a local map.
- **`agent.renamePanel`** — Updates a panel's title by `chatId`.
- **`agent.updatePanelStatus`** — Sets the panel icon color based on status (`streaming` → yellow, `ready` → green, `error` → red).

Each panel gets a unique ID (`diffs.agent.chat.N`) and loads `agent/chat.tsx` as its React module.

## Router (`extensions/agent/router.ts`)

oRPC endpoints mounted on the server:

- **`chat`** — Streaming endpoint. Validates messages, calls the agent, pipes back a UI message stream. Saves on finish.
- **`models`** — Lists available models, with optional filter.
- **`history`** / **`historyList`** — Load a single chat's messages or list recent chats.
- **`historyDelete`** — Remove a chat.
- **`threadsList`** — List agent threads across open workspaces.

## Client (`client/src/extensions/agent/chat.tsx`)

React panel using the `ai-elements` component library (`components/ai-elements/`). Handles:

- Message rendering (user + assistant, tool calls, reasoning)
- Model selection via `ModelSelector`
- Prompt input with `PromptInput`
- Streaming responses via the `chat` RPC endpoint
- Panel title/status updates via commands
