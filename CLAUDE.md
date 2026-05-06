# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

OpenClaw is a **Gateway-centric control plane** for messaging channels and AI agents. The Gateway maintains channel connections, exposes HTTP + WebSocket interfaces, and is consumed by CLI, Web UI, Tauri desktop, and plugin extensions. Think of it as:

- **Gateway** = backend hub (HTTP + WS server, session/agent management, event bus)
- **CLI** = management entry point + local operations (`src/commands/`)
- **UI** = control console frontend (`ui/`)
- **Tauri** = desktop shell + Gateway subprocess manager (`src-tauri/`)
- **Extensions** = pluggable channel/capability add-ons (`extensions/`)

## Monorepo Structure

pnpm workspaces: root `.`, `ui`, `packages/*`, `extensions/*`.

Key source directories:

- `src/gateway/` — Gateway server core (`server.ts`, `server.impl.ts`, `client.ts`)
- `src/routing/` — Message→session mapping (`resolve-route.ts`, `session-key.ts`)
- `src/channels/` — Shared channel abstractions (allowlist, gating, thread binding)
- `src/telegram/`, `src/discord/`, `src/slack/`, `src/signal/`, `src/imessage/`, `src/web/` — Built-in channels
- `src/acp/` — Agent Control Protocol bridge layer (`server.ts`, `translator.ts`)
- `src/agents/` — Agent runtime, model integration
- `src/config/` — Configuration loading, schema (`schema.ts` is key), session store
- `src/cli/` — CLI wiring; `deps.ts` has `createDefaultDeps()` (important DI assembly point)
- `src/commands/` — CLI command implementations (application service layer)
- `src/media/` — Media processing pipeline
- `src/infra/` — Runtime guards, environment, binary management, port, errors
- `extensions/` — 130+ plugin extensions (channels, AI providers, capabilities)
- `ui/` — Control console frontend (builds to `dist/control-ui/`)
- `src-tauri/` — Tauri v2 Rust desktop shell

Entry points:

- `openclaw.mjs` → Node version check → loads `dist/entry.js`
- `src/index.ts` → composition root (env vars, default deps, CLI program)

## Build, Test, and Lint Commands

```bash
pnpm install                # install deps
pnpm build                  # type-check + build (tsdown → dist/)
pnpm tsgo                   # TypeScript type checking only
pnpm check                  # lint + format check (oxlint + oxfmt)
pnpm lint                   # oxlint only
pnpm format                 # oxfmt --check
pnpm format:fix             # oxfmt --write

pnpm test                   # vitest (all tests)
pnpm test:fast              # fast subset
pnpm test:gateway           # gateway tests
pnpm test:extensions        # extension tests
pnpm test:e2e               # end-to-end tests
pnpm test:coverage          # with V8 coverage (70% threshold)

pnpm dev                    # run CLI in dev mode
pnpm gateway:dev            # run gateway in dev mode
pnpm ui:dev                 # run UI dev server
pnpm ui:build               # build UI → dist/control-ui/

# Tauri desktop
cargo tauri dev              # dev mode (from src-tauri/)
pnpm installer:build         # full release build
pnpm installer:build:debug   # debug build (faster)
```

Node **22+** required. Prefer pnpm for package management, Bun for TS execution (`bun <file.ts>`).

## Build Artifacts & Dev/Production Differences

| Artifact | Location | Used By |
|---|---|---|
| CLI/Node build | `dist/` | `openclaw.mjs` → `dist/entry.js` |
| UI build | `dist/control-ui/` | Tauri `frontendDist`, web access |
| Desktop bundle | `src-tauri/gateway-bundle/` | Tauri production builds |

**Tauri dev mode**: `OPENCLAW_GATEWAY_BUNDLE_DIR` → project root.
**Tauri production**: `OPENCLAW_GATEWAY_BUNDLE_DIR` → `<resource_dir>/gateway-bundle/`.

The bundle is created by `scripts/prepare-gateway-bundle.js` (Tauri's `beforeBuildCommand`) and includes `openclaw.mjs`, `dist/`, `assets/`, `skills/`, `extensions/`, and pruned `node_modules/`.

**Common pitfall**: Tauri debug builds load from `src-tauri/target/debug/gateway-bundle/dist/`, not the project root `dist/`. After recompiling TypeScript, the Tauri app won't see changes unless the bundle is also updated.

## Message Flow (Critical Path)

```
External message
  → Channel adapter (接入)
  → Shared channel rules / allowlist / gating
  → Routing: resolve sessionKey
  → Gateway session / Agent invocation
  → Response / action produced
  → Channel outbound → external world
  → WS event broadcast to CLI/UI/nodes
```

Key files in this path: channel adapters (`src/<channel>/`), `src/channels/` (shared rules), `src/routing/resolve-route.ts` (session binding), `src/gateway/server.impl.ts` (core processing).

## Coding Conventions

- **TypeScript ESM** (`"type": "module"`). Strict typing; no `any`, no `@ts-nocheck`.
- **Formatting/linting**: oxlint + oxfmt. Run `pnpm check` before commits.
- **Dynamic imports**: don't mix `await import("x")` and static `import ... from "x"` for the same module. Create a `*.runtime.ts` boundary for lazy loading.
- **No prototype mutation**: no `applyPrototypeMixins`, no `Object.defineProperty` on `.prototype`. Use explicit inheritance/composition.
- **File size**: aim for ~500-700 LOC max; split/refactor for clarity.
- **Naming**: **OpenClaw** for product/docs headings; `openclaw` for CLI/package/paths/config keys.
- **American English** in code, comments, docs, UI strings.
- **Comments**: add brief comments for tricky/non-obvious logic only.
- **Commits**: use `scripts/committer "<msg>" <file...>` (scoped staging). Concise, action-oriented messages.

## Plugin/Extension System

Extensions under `extensions/` are first-class runtime citizens, not just examples. They're included in the desktop bundle and participate in the same Gateway/routing system as built-in channels.

The root `package.json` exports 40+ `plugin-sdk/*` sub-paths for fine-grained extension imports. Plugin-only deps belong in the extension's `package.json`, not the root.

When refactoring shared channel logic (routing, allowlists, pairing, command gating), consider **all** built-in + extension channels.

## WebSocket Protocol

The system uses a `req/res/event` protocol over WebSocket as its unified control plane. Clients (CLI, UI, nodes) `connect` then communicate via this protocol. The Gateway broadcasts health state, session events, and agent streaming output.

## Testing

- Framework: Vitest with V8 coverage thresholds (70% lines/branches/functions/statements).
- Tests colocated as `*.test.ts`; e2e as `*.e2e.test.ts`.
- Low-memory environments: `OPENCLAW_TEST_PROFILE=low OPENCLAW_TEST_SERIAL_GATEWAY=1 pnpm test`.
- Live tests (real keys): `CLAWDBOT_LIVE_TEST=1 pnpm test:live`.

## Key References

- `AGENTS.md` — Full operational guidelines for AI agents (PR workflow, release process, security, multi-agent safety)
- `ARCHITECTURE.md` — Detailed Chinese-language architecture notes (module map, data flow, recommended code reading order)
- `src/config/schema.ts` — Configuration schema; essential index of system capabilities
- `docs/` — User-facing documentation (Mintlify-hosted)
