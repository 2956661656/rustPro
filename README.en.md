[![zh](https://img.shields.io/badge/lang-zh-blue.svg)](./README.md)

# Rust Call Graph Analyzer (rustPro)

A visual call graph analysis tool for Rust projects based on rust-analyzer LSP. Built with Electron + React + D3.js v7, it helps developers quickly understand function call relationships in Rust codebases. Especially useful when collaborating with AI agents.

## Features

- **🔍 Project Analysis** — Automatically discovers all functions and methods in the project via rust-analyzer LSP, building a complete call graph
- **📊 Interactive Visualization** — D3.js v7 force-directed graph with zoom, drag, and hover highlighting
- **🧭 Smart Navigation** — Click nodes to explore call chains, with forward/back history
- **🎨 Three Layout Modes** — Auto-switches based on node count:
  - **Radial layout** (≤15 nodes): Callers on the left semicircle, callees on the right
  - **Tree layout** (16-40 nodes): Top-down hierarchical tree
  - **Force layout** (>40 nodes): D3 force simulation directed graph
- **🔎 Search** — Quickly search and jump to functions by name
- **📂 Module View** — Functions organized by module/file for clear overview
- **📋 Type Info** — Full signature and return type for the selected function
- **📄 Function Preview** — Preview source code in the right panel
- **🔗 External Dependencies** — Optionally show external crate call relationships (hidden by default)
- **🖱️ Node Dragging** — Freely drag nodes to adjust layout in force mode
- **⭐ Highlight System** — Highlight connected paths on selection, auto-dim unrelated nodes
- **🔄 Recursive Peek** — Hover or right-click nodes to progressively reveal third-layer and deeper call relationships with gradual blur + opacity falloff; supports recursive expansion
- **💡 Smart Tooltip** — Hover to show detailed node info (fixed bottom-right by default); automatically moves to the opposite side during drag to avoid occlusion; stays in place after release

## Installation

### Prerequisites

- **Node.js** >= 18
- **npm** >= 9
- **rust-analyzer** must be in your `PATH` (or set via `RUST_ANALYZER_PATH` environment variable)
- A Rust project (requires `Cargo.toml`)

### Setup

```bash
# Clone the repository
git clone https://github.com/2956661656/rustPro.gi
cd rustPro

# Install dependencies
npm install

# Start dev server
npm run dev
```

> **Note**: The Electron window opens automatically on first launch. Without rust-analyzer the app boots but analysis fails silently.

## Usage

1. **Launch**: Run `npm run dev`, the Electron window opens automatically
2. **Open project**: Enter the root path of a Rust project in the search bar and click "Analyze"
3. **Explore the call graph**:
   - Click any node to see its callers (left) and callees (right)
   - Use the ← → buttons in the top navigation bar for history
   - Use the search box to quickly locate functions by name
4. **Adjust the view**:
   - Scroll to zoom
   - Drag empty space to pan
   - Drag nodes to rearrange
5. **Filter**: Toggle "Show External" to control display of external crate calls
6. **Deep exploration**:
   - **Hover preview**: Hover over a node for ~200ms to reveal third-layer (2-degree) call nodes with progressive blur
   - **Pin preview**: Right-click a node to pin the preview layer permanently
   - **Recursive expand**: Continue right-clicking on pinned layers to drill deeper
   - **Drag follow**: When dragging a parent node, all preview children follow along
   - **Cross-layer edges**: Peek nodes connect to main graph nodes with cross-layer edges

### Legend

- Node labels may show: [🧬 derived] (trait) [source filename]
- Dashed lines indicate external crates; solid lines are project-internal calls
- Cyan dashed lines indicate **derived/impl** relationships

## Project Structure

```
rustPro/
├── electron/                  # Electron main process
│   ├── main.ts                # App entry, IPC handlers
│   ├── preload.ts             # contextBridge API exposure
│   ├── graph-builder.ts       # Call graph builder (LSP communication)
│   ├── scanner.ts             # Project scanner
│   ├── logger.ts              # Logging system
│   └── lsp/                   # LSP client
│       ├── client.ts          # rust-analyzer JSON-RPC communication
│       └── types.ts           # LSP protocol type definitions
├── src/                       # Renderer process (React + Vite)
│   ├── App.tsx                # Main app component
│   ├── App.css                # Global styles
│   ├── main.tsx               # React entry point
│   ├── components/
│   │   ├── GraphCanvas.tsx    # D3.js interactive call graph (core)
│   │   ├── GraphCanvasStatic.tsx # Static graph renderer (fallback)
│   │   ├── SearchBar.tsx      # Search bar
│   │   ├── ModuleList.tsx     # Module list
│   │   ├── NavigationHeader.tsx # Navigation header
│   │   ├── ProjectStatus.tsx  # Project status display
│   │   ├── FileTree.tsx       # File tree
│   │   ├── FunctionPreview.tsx # Function preview
│   │   ├── TypeInfo.tsx       # Type information
│   │   ├── RightPanel.tsx     # Right panel
│   │   └── EdgeStateOverlay.tsx # Edge state overlay
│   ├── store/
│   │   └── useGraphStore.ts   # Zustand state management
│   ├── hooks/
│   │   ├── useLSPClient.ts    # LSP IPC communication hook
│   │   └── useDirectoryTree.ts # Directory tree hook
│   ├── types/
│   │   ├── graph.ts           # Graph data model
│   │   └── directory.ts       # Directory structure types
│   └── utils/
│       └── index.ts           # Utility functions
├── build/
│   └── entitlements.mac.plist # macOS signing config
├── vite.config.ts             # Vite + Electron build config
├── electron-builder.yml       # Electron packaging config
├── tsconfig.json              # TypeScript config (renderer)
└── tsconfig.node.json         # TypeScript config (main process)
```

## Tech Stack

| Tech | Purpose |
|------|---------|
| **Electron** | Desktop application shell |
| **React 18** | UI framework |
| **Vite** | Build tool |
| **TypeScript** | Type safety |
| **D3.js v7** | Graph visualization (force layout, SVG rendering) |
| **Zustand** | Lightweight state management |
| **rust-analyzer** | LSP-based Rust code analysis |

## Dev Commands

```bash
# Start dev server (Vite HMR + auto-launch Electron)
npm run dev

# TypeScript type check (renderer)
npx tsc --noEmit -p tsconfig.json

# TypeScript type check (main process)
npx tsc --noEmit -p tsconfig.node.json

# Production build
npm run build
```

## Data Flow

```
User Action → React Component → Zustand Store → GraphCanvas (D3.js)
                                    ↕
                               IPC Communication
                                    ↕
Electron Main Process → LSP Client → rust-analyzer (stdin/stdout JSON-RPC)
```

## Logging

Log files are stored at `logs/app-YYYY-MM-DD_HH-MM-SS.log`. All `console.log/warn/error/debug` output from the renderer process is forwarded to the main process log file.

When debugging, search for these prefixes:
- `[GC]` — GraphCanvas component logs
- `[GraphBuilder]` — Graph builder logs
- `[LSP]` — LSP client logs
- `[Store]` — Zustand store logs

## License

[Apache 2.0](LICENSE)
