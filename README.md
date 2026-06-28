[![en](https://img.shields.io/badge/lang-en-red.svg)](./README.en.md)

# Rust Call Graph Analyzer (rustPro)

基于 rust-analyzer LSP 的 Rust 项目调用图可视化分析工具。使用 Electron + React + D3.js v7 构建，帮助开发者快速理解 Rust 代码库中的函数调用关系。
在与 Agent 共同开发时格外有用。

## 功能特性

- **🔍 项目分析** —— 通过 rust-analyzer LSP 自动发现项目中的所有函数、方法，构建完整的调用图
- **📊 交互式可视化** —— 基于 D3.js v7 的力导向图，支持缩放、拖拽、悬停高亮
- **🧭 智能导航** —— 点击节点探索函数调用链，支持前进/后退历史记录
- **🎨 三种布局模式** —— 根据节点数量自动切换：
  - **径向布局**（≤15 节点）：调用方在左半圆，被调用方在右半圆
  - **树形布局**（16-40 节点）：自上而下的层次树
  - **力导向布局**（>40 节点）：基于 D3 force simulation 的力导向图
- **🔎 搜索定位** —— 按函数名快速搜索并跳转到目标节点
- **📂 模块视图** —— 按模块/文件组织函数列表，一目了然
- **📋 类型信息** —— 显示选中函数的完整签名和返回值类型
- **📄 函数预览** —— 在下方面板预览函数源码
- **🔗 外部依赖** —— 可选显示外部 crate 的调用关系（默认隐藏）
- **🖱️ 节点拖动** —— 力导向布局下自由拖动节点调整布局
- **⭐ 高亮系统** —— 选中节点高亮显示关联链路，非关联节点自动淡化
- **🔄 递归预览** —— 悬停或右键点击节点，递进式展示第三层及更深层的调用关系，逐层虚化（blur + opacity），支持递归展开
- **💡 智能悬浮窗** —— 节点悬浮显示详细信息，拖拽时自动移至对侧避免遮挡，松手后保持原位

## 安装

### 前提条件

- **Node.js** >= 18
- **npm** >= 9
- **rust-analyzer** 必须在 `PATH` 环境变量中（可通过 `RUST_ANALYZER_PATH` 环境变量指定路径）
- 一个 Rust 项目（需要 `Cargo.toml`）

### 安装步骤

```bash
# 克隆仓库
git clone https://github.com/2956661656/rustPro.gi
cd rustPro

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

> **注意**：首次启动会自动打开 Electron 窗口。如果没有 rust-analyzer，应用可以启动但分析会静默失败。

## 使用方法

1. **启动应用**：运行 `npm run dev`，Electron 窗口自动打开
2. **打开项目**：在搜索栏输入 Rust 项目的根目录路径，点击"分析"按钮
3. **探索调用图**：
   - 点击任意节点查看其调用方（左）和被调用方（右）
   - 使用顶部导航栏的 ← → 按钮在历史记录中导航
   - 使用搜索框按函数名快速定位
4. **调整视图**：
   - 鼠标滚轮缩放
   - 拖拽空白区域平移
   - 拖拽节点调整布局
5. **筛选**：使用"显示外部"开关控制是否显示外部 crate 的调用
6. **深度探索**：
   - **悬停预览**：鼠标悬停在节点上约 200ms，显示第三层（2 度）调用节点，递进式虚化
   - **固定预览**：右键点击节点将预览层固定为永久层
   - **递归展开**：在固定层上继续右键点击，可递归展开更深层次
   - **拖拽跟随**：拖拽父节点时，所有预览子节点跟随移动
   - **跨层连线**：预览节点与主图节点之间存在跨层边

### 指示说明

- 点击一个函数查看当前节点，函数名后面跟着的表示当前函数是 [🧬派生的] (trait trait中的) [所属文件名]。
- 虚线表示外部库，实线表示自己项目中的函数，青色虚线表示**派生**关系。

## 项目结构

```
rustPro/
├── electron/                  # Electron 主进程
│   ├── main.ts                # 应用入口，IPC 处理
│   ├── preload.ts             # contextBridge 暴露 API
│   ├── graph-builder.ts       # 调用图构建器（LSP 通信）
│   ├── scanner.ts             # 项目扫描器
│   ├── logger.ts              # 日志系统
│   └── lsp/                   # LSP 客户端
│       ├── client.ts          # rust-analyzer JSON-RPC 通信
│       └── types.ts           # LSP 协议类型定义
├── src/                       # 渲染进程（React + Vite）
│   ├── App.tsx                # 主应用组件
│   ├── App.css                # 全局样式
│   ├── main.tsx               # React 入口
│   ├── components/
│   │   ├── GraphCanvas.tsx    # D3.js 交互式调用图（核心组件）
│   │   ├── GraphCanvasStatic.tsx # 静态图渲染（备选）
│   │   ├── SearchBar.tsx      # 搜索栏
│   │   ├── ModuleList.tsx     # 模块列表
│   │   ├── NavigationHeader.tsx # 导航栏
│   │   ├── ProjectStatus.tsx  # 项目状态显示
│   │   ├── FileTree.tsx       # 文件树
│   │   ├── FunctionPreview.tsx # 函数预览
│   │   ├── TypeInfo.tsx       # 类型信息
│   │   ├── RightPanel.tsx     # 右侧面板
│   │   └── EdgeStateOverlay.tsx # 边调用点覆盖
│   ├── store/
│   │   └── useGraphStore.ts   # Zustand 状态管理
│   ├── hooks/
│   │   ├── useLSPClient.ts    # LSP IPC 通信 Hook
│   │   └── useDirectoryTree.ts # 目录树 Hook
│   ├── types/
│   │   ├── graph.ts           # 图数据模型
│   │   └── directory.ts       # 目录结构类型
│   └── utils/
│       └── index.ts           # 工具函数
├── build/
│   └── entitlements.mac.plist # macOS 签名配置
├── vite.config.ts             # Vite + Electron 构建配置
├── electron-builder.yml       # Electron 打包配置
├── tsconfig.json              # TypeScript 配置（渲染进程）
└── tsconfig.node.json         # TypeScript 配置（主进程）
```

## 技术栈

| 技术 | 用途 |
|------|------|
| **Electron** | 桌面应用壳 |
| **React 18** | UI 框架 |
| **Vite** | 构建工具 |
| **TypeScript** | 类型安全 |
| **D3.js v7** | 图形可视化（力导向图、SVG 渲染） |
| **Zustand** | 轻量级状态管理 |
| **rust-analyzer** | LSP 协议分析 Rust 代码 |

## 开发命令

```bash
# 启动开发服务器（Vite HMR + Electron 自动启动）
npm run dev

# TypeScript 类型检查（渲染进程）
npx tsc --noEmit -p tsconfig.json

# TypeScript 类型检查（主进程）
npx tsc --noEmit -p tsconfig.node.json

# 生产构建
npm run build
```

## 数据流

```
用户操作 → React 组件 → Zustand Store → GraphCanvas (D3.js)
                               ↕
                          IPC 通信
                               ↕
Electron 主进程 → LSP Client → rust-analyzer (stdin/stdout JSON-RPC)
```

## 日志

应用日志位于 `logs/app-YYYY-MM-DD_HH-MM-SS.log`。渲染进程的所有 `console.log/warn/error/debug` 输出都会被转发到主进程的日志文件。

调试时搜索以下前缀：
- `[GC]` —— GraphCanvas 组件日志
- `[GraphBuilder]` —— 图构建器日志
- `[LSP]` —— LSP 客户端日志
- `[Store]` —— Zustand store 日志

## 许可

[Apache 2.0](LICENSE)
