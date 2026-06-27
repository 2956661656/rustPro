# AGENTS.md — Rust Call Graph Analyzer

## Overview
Electron + React + Vite + D3.js v7 + Zustand app that uses rust-analyzer LSP to
visualize Rust project call graphs. Main process (`electron/`) talks to
rust-analyzer via stdin/stdout JSON-RPC. Renderer (`src/`) displays results.

## Prerequisites
- **rust-analyzer MUST be in PATH** or set `RUST_ANALYZER_PATH` env var.
  The app boots without it but analysis fails silently.

## Developer commands

| Task                  | Command                                | Notes                                                |
| --------------------- | -------------------------------------- | ---------------------------------------------------- |
| Dev server            | `npm run dev`                            | Vite + Electron auto-launch via vite-plugin-electron |
| Type check (renderer) | `npx tsc --noEmit -p tsconfig.json`      | `src/` only                                            |
| Type check (main)     | `npx tsc --noEmit -p tsconfig.node.json` | `electron/` + `src/types/`                               |
| Verify all            | Both tsc commands above                | No linter, no test framework — tsc is the only gate  |

## Architecture

```
Renderer (React + Vite)          Main process (Electron + Node)
─────────────────────────        ─────────────────────────────
App.tsx                          electron/main.ts
  ├─ SearchBar                        ├─ ipcMain.handle('analyze-project'...)
  ├─ ModuleList                       ├─ ipcMain.handle('get-edges-for-node'...)
  ├─ NavigationHeader                 ├─ LSPClient (electron/lsp/client.ts)
  ├─ TypeInfo                              ├─ findRustAnalyzer()
  ├─ ProjectStatus                         ├─ stdin/stdout JSON-RPC to rust-analyzer
  └─ GraphCanvas                           └─ isUserCode(uri) — workspace membership
        ↓                            ├─ GraphBuilder (electron/graph-builder.ts)
  useLSPClient() ← hook                 ├─ discoverNodes()   → documentSymbol
  useGraphStore() ← Zustand             ├─ getEdgesForNode() → prepareCallHierarchy + getCallHierarchy
        ↓                               └─ parseFunctionDetail() → type extraction
  window.electronAPI.* ──IPC──→    └─ ProjectScanner (electron/scanner.ts)
```

Double tsconfig: `src/types/graph.ts` is shared by both (included in both configs).
Changing FunctionNode/CallEdge affects BOTH sides — always verify both tsc passes.

## IPC data flow detail
- preload.ts exposes `window.electronAPI` via contextBridge
- `getEdgesForNode`/`getEdgesForNodes` pass node data as **serialized JSON strings**
  (not objects) due to Electron structured clone limitations
- Progress/error events flow main→renderer via `ipcRenderer.on('analysis-progress')`

## Logging — dual-intercept, check here first for bugs
- **Main process**: `electron/logger.ts` writes to `logs/app-YYYY-MM-DD_HH-MM-SS.log`
- **Renderer**: `src/main.tsx` forwards ALL `console.log/error/warn/debug` to main
  process via `electronAPI.logToFile()` — everything ends up in the log file
- **LSP diagnostic spam is filtered**: non-error `textDocument/publishDiagnostics`
  capped at 50 lines per session in `electron/logger.ts:write()`
- Use log grep patterns: `[GraphBuilder]`, `[LSP]`, `[Store]`, `[App]`, `[GC]`

## Zustand store (src/store/useGraphStore.ts)
Key fields and actions beyond obvious CRUD:
- `selectedNodeId` — the currently focused function (drives subgraph view)
- `focusHistory: string[]` — stack for back navigation (managed by focusNode/goBack)
- `showExternal: boolean` — toggle for showing stdlib/external crate edges (default OFF)
- `focusNode(id)` — pushes current selectedNodeId to history, then sets new focus
- `goBack()` — pops history, sets focus (or null if empty)
- `addNodes()` / `addEdges()` — deduplicates by `id` / `source:target` key; idempotent
- `analysisStatus` lifecycle: `idle → analyzing → ready (data) | ready (empty) | error`

## GraphCanvas quirks (src/components/GraphCanvas.tsx, ~729 lines)
- Three layout modes by node count: `≤15 radial`, `16-40 tree`, `>40 force`
- `focusNodeId` prop triggers edge loading from LSP via `loadEdgesForNode()`
- Radial layout: callers left semi-circle, callees right; adaptive gap prevents overlap
- Edge arrows use SVG `<marker>` defined in Effect 1a (once on init)
- External nodes: radius 5px, dashed stroke, muted color; external edges: dashed
- Label collisions: same-named functions get `[filename]` suffix (extracted from filePath)
- D3 link key function: MUST handle string source/target at data-join time
  (`typeof d.source === 'string' ? d.source : (d.source as SimNode).id`)

## Known footguns
1. `inferModuleName()` returns only top-level dir (`"src"`). Never use module for
   disambiguation — use filename from `filePath` instead.
2. `nodeIdFromCallItem()` converts file:// URIs to filesystem paths via
   `fileURLToPath()`. IDs are `${filesystemPath}:${line}` format everywhere.
3. `prepareCallHierarchy` has 3 retries (600ms delay) for "content modified" (-32801)
   and empty-result race conditions in `graph-builder.ts:getEdgesForNode()`.
4. `FunctionNode.character` stores `selectionRange.start.character` — must use this
   (not 0) when calling prepareCallHierarchy.
5. No linter, no tests — tsc is the ONLY automated verification gate.
6. `vite-plugin-electron` auto-builds `dist-electron/` from `electron/`. Changes to
   electron/ files need a dev server restart to take effect (HMR only covers src/).
