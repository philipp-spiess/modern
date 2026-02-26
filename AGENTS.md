# Repository Guidelines

## Project Structure & Module Organization

The repo is a Bun workspace wrapped by Tauri 2. React UI code lives in `packages/client/src`, with view components in `components/`, extension-specific panels in `extensions/`, and RPC helpers in `lib/`. The Bun RPC backend sits in `packages/server/src/router.ts` and mounts extension routers under `packages/server/src/extensions`. `packages/server/src/extension.ts` hosts the extension runtime (`diffs.commands`, `diffs.window`, `diffs.workspace`, `diffs.storage`) that both built-in extensions use. Tauri assets stay under `src-tauri` (config in `tauri.conf.json`, Rust entry points in `src/main.rs` and `src/lib.rs`). Generated output under each `dist/` and the Rust `target/` folder must remain untracked.

## Build, Test, and Development Commands

- `bun install` installs workspace dependencies with the pinned `bun@1.3.0` declared in `package.json`.
- `bun run dev` proxies to `tauri dev`, booting the Bun server, React client, and Tauri shell together.
- `bun run tauri build` uses the `tauri` binary to emit production assets and bundle the desktop app.
- `bun run lint` runs `oxlint --fix --deny-warnings .`; expect it to mutate files to resolve lint errors instead of waiving them.
- `bun run format` fans out via `concurrently` to execute `oxfmt .` and `bun run lint`, keeping formatting and lint fixes in lockstep.
- `bun run check` is the gated pre-push workflow: `oxfmt --check .`, `bun run lint`, and `bun run --workspaces check` execute in parallel, so failures from any workspace surface immediately.

## Coding Style & Naming Conventions

- Stick to TypeScript + JSX with 2-space indentation and sorted ES imports.
- Prefer bun-specific APIs in the server code.
- Prefer Suspense-powered data fetching (e.g. `useSuspenseQuery`) over `useQuery` to avoid intermediate loading spinners.
- Rely on `oxfmt` and `oxlint`; do not suppress warnings.
- Rust modules in `src-tauri/src` follow `rustfmt` conventions and snake_case functions.
- It's okay to break backward compatibility.

## Extensions Architecture

- **Runtime overview**: `packages/server/src/extension.ts` isolates each extension in `AsyncLocalStorage`, exposing the `diffs` API. `diffs.window.createReactPanel` bootstraps client modules (relative to `packages/client/src`) inside desktop panels, `diffs.commands.registerCommand` bridges command invocations back into the Bun process, and `diffs.workspace.cwd`/`diffs.storage` give extensions scoped filesystem and persistence access.
- **Extension docs**: see `docs/extensions.md` for a single-page guide (setup, API quick reference, and examples). Keep it in sync when changing `packages/server/src/extension.ts` or extension wiring.

## Testing Guidelines

Prefer Bun’s `bun test` with colocated specs (`*.test.ts`) when adding unit test coverage.

## Commit & Pull Request Guidelines

- Do atomic and small commits for logical changes, only when asked.
- Capitalize the first letter of the commit message.
- Prefix the commit with the package name or area if necessary, e.g., `web:`, `plugin:`, `shared:`, `ci:`.
- Keep commit subjects concise and imperative (e.g., “Add oxfmt and oxlint”) and titles under ~60 characters.
- Isolate unrelated changes.
- Always run `bun run format` before committing (auto-runs via pre-commit hook).
- A Husky pre-commit hook runs `bun run check && bun test` automatically on every commit, so you do not need to run `bun run check` or `bun test` manually before committing — the hook will catch any failures.
- PRs must outline scope, link issues, and attach UI evidence when relevant.

## UI testing

You can connect to the frontend via Chrome DevTools MCP server at http://localhost:1420/. To do this, first start the Tauri dev app in the background via `bun dev`. Once the app is running, you can connect to the frontend via the MCP server.

## Cursor Cloud specific instructions

### Tauri shell limitation on Linux

The Tauri Rust shell (`src-tauri`) cannot compile on Linux because `Cargo.toml` lists `objc2`, `objc2-app-kit`, and `objc2-foundation` as unconditional dependencies (they are macOS-only). The `bun run dev` command (which wraps `tauri dev`) will fail during `cargo build`. This does **not** affect TypeScript code, tests, lint, or type-checking.

### Running services without Tauri

Start the Bun backend and Vite frontend independently:

```bash
# Bun oRPC server (prints JSON with port and token to stdout)
PORT=3000 bun run --cwd packages/server dev

# Vite React frontend (serves on http://localhost:1420)
bun --cwd packages/client dev
```

The server auto-shuts down after 60 seconds with no WebSocket connections. Keep a client connected or restart as needed.

The frontend in a browser renders a dark canvas but cannot fully function without the Tauri shell acting as the "leader" for the `vite-plugin-tauri-in-the-browser` proxy. For testing TypeScript/server changes, use `bun test` and `bun run check` which both work fully.

### Key commands (see README.md for full list)

| Task                    | Command                               |
| ----------------------- | ------------------------------------- |
| Install deps            | `bun install`                         |
| Lint (auto-fix)         | `bun run lint`                        |
| Format                  | `bun run format`                      |
| Type-check + lint + fmt | `bun run check`                       |
| Run tests               | `bun test`                            |
| Build server sidecar    | `bun run --cwd packages/server build` |
