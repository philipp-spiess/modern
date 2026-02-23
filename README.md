<p align="center">
  <img src="src-tauri/icons/128x128.png" width="64" height="64" alt="Modern" />
</p>

<h1 align="center">Modern</h1>

<p align="center">
  A desktop coding environment with a built-in AI agent, file editor, diff review, and terminal.<br />
  Built with Tauri 2, React, and Bun.
</p>

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.3.0+
- [Rust](https://rustup.rs/) (for Tauri)

### Setup

```bash
git clone https://github.com/philipp-spiess/modern.git
cd modern
bun install

# Build the server sidecar (required once, and after server changes)
bun run --cwd packages/server build

# Start the app
bun dev
```

## Project Structure

```
packages/
├── client/    — React frontend (Vite)
│   └── src/
│       ├── components/   — Shell UI (sidebar, tabs, command palette)
│       └── extensions/   — Panel views (agent, files, review, terminal)
├── server/    — Bun backend (oRPC over WebSocket)
│   └── src/
│       ├── extensions/   — Extension logic (agent, files, review, terminal)
│       └── extension.ts  — Extension runtime API
src-tauri/     — Tauri shell (Rust)
```

## Development

```bash
# Start dev (Tauri + Vite + Bun server)
bun dev

# Type check, lint, format
bun run check

# Format code
bun run format
```

## Tech Stack

- **Desktop**: [Tauri 2](https://v2.tauri.app/)
- **Frontend**: [React 19](https://react.dev/) + [Vite](https://vite.dev/) + [Tailwind CSS 4](https://tailwindcss.com/)
- **Backend**: [Bun](https://bun.sh/) + [oRPC](https://orpc.unnoq.com/)
- **AI**: [Pi coding agent](https://github.com/nicolo-ribaudo/pi-coding-agent)
- **Editor**: [CodeMirror](https://codemirror.net/) + [Shiki](https://shiki.style/)
- **Quality**: [oxlint](https://oxc.rs/) + [oxfmt](https://oxc.rs/) + [tsgo](https://github.com/nicolo-ribaudo/tsgo)
