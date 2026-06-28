import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { LSPClient } from './lsp/client'
import type { Hover, MarkupContent, MarkedString } from './lsp/types'
import { GraphBuilder } from './graph-builder'
import { initLogger, closeLogger, writeLog } from './logger'

// Initialize file logger before anything else
initLogger()

let mainWindow: BrowserWindow | null = null
let lspClient: LSPClient | null = null
let graphBuilder: GraphBuilder | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL).catch((err) => {
      console.error('Failed to load dev server URL:', err)
    })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html')).catch((err) => {
      console.error('Failed to load production file:', err)
    })
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', async () => {
  if (lspClient) {
    await lspClient.shutdown()
    lspClient = null
    graphBuilder = null
  }
  closeLogger()
})

// ─── IPC Handlers ──────────────────────────────────────────────────

/**
 * Log a message from the renderer process.
 */
ipcMain.on('log-message', (_event, level: string, message: string) => {
  writeLog(level, message)
})

/**
 * Ping test - verify IPC bridge is working.
 */
ipcMain.handle('ping', () => {
  return { status: 'ok', timestamp: Date.now() }
})

/**
 * Analyze a Rust project: scan files, discover nodes, build call graph.
 * This is the main entry point for Phase 3.
 */
ipcMain.handle('analyze-project', async (event, projectPath: string) => {
  if (!projectPath || typeof projectPath !== 'string') {
    throw new Error('Invalid project path')
  }

  // Validate path exists
  const fs = await import('fs')
  if (!fs.existsSync(projectPath)) {
    throw new Error(`Project path does not exist: ${projectPath}`)
  }

  try {
    // Initialize LSP client
    lspClient = new LSPClient({
      workspaceRoot: projectPath,
    })

    // Listen for progress events from LSP
    lspClient.setNotificationHandler((method, params) => {
      console.log('[LSP notification]', method, params)
    })

    await lspClient.start()

    // Create graph builder
    graphBuilder = new GraphBuilder(lspClient, projectPath)

    // Send progress updates to renderer
    const sendProgress = (progress: number, message: string) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('analysis-progress', progress, message)
      }
    }

    // Discover nodes (Phase 3.3)
    sendProgress(0, 'Scanning project files...')
    const nodeResult = await graphBuilder.discoverNodes(sendProgress)
    
    // Return initial result (nodes only, edges loaded on demand in Phase 6)
    return {
      nodes: nodeResult.nodes,
      filesProcessed: nodeResult.filesProcessed,
      totalFiles: nodeResult.totalFiles,
      stats: {
        totalFunctions: nodeResult.nodes.length,
        filesProcessed: nodeResult.filesProcessed,
      },
    }
  } catch (err) {
    console.error('[analyze-project] Error:', err)
    // Send error to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('analysis-error', `Analysis failed: ${err}`)
    }
    throw err
  }
})

/**
 * Get edges for a specific function node (lazy edge loading, Phase 6).
 */
ipcMain.handle('get-edges-for-node', async (_event, nodeJson: string) => {
  if (!graphBuilder) {
    throw new Error('Analysis not started. Call analyze-project first.')
  }

  const node = JSON.parse(nodeJson)
  return await graphBuilder.getEdgesForNode(node)
})

/**
 * Get all edges for multiple nodes.
 */
ipcMain.handle('get-edges-for-nodes', async (_event, nodesJson: string) => {
  if (!graphBuilder) {
    throw new Error('Analysis not started. Call analyze-project first.')
  }

  const nodes = JSON.parse(nodesJson)
  return await graphBuilder.getEdgesForNodes(nodes)
})

/**
 * Get the complete call graph (all nodes + all edges).
 */
ipcMain.handle('get-complete-graph', async (event, projectPath: string) => {
  if (!graphBuilder) {
    throw new Error('Analysis not started. Call analyze-project first.')
  }

  const sendProgress = (progress: number, message: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('analysis-progress', progress, message)
    }
  }

  return await graphBuilder.buildCompleteGraph(sendProgress)
})

/**
 * Get call hierarchy stats for a specific function.
 */
ipcMain.handle('get-function-stats', async (_event, nodeJson: string) => {
  if (!graphBuilder) {
    throw new Error('Analysis not started.')
  }

  const node = JSON.parse(nodeJson)
  const edges = await graphBuilder.getEdgesForNode(node)
  return {
    ...edges,
    totalIncoming: edges.incoming.length,
    totalOutgoing: edges.outgoing.length,
  }
})

/**
 * Get the source code for a specific function node.
 * Reads the file directly and extracts the function body using line range.
 */
ipcMain.handle('get-function-source', async (_event, nodeJson: string) => {
  const node = JSON.parse(nodeJson)

  if (!node.filePath || node.line === undefined) {
    throw new Error('Invalid node: missing filePath or line')
  }

  const fs = await import('fs')
  if (!fs.existsSync(node.filePath)) {
    throw new Error(`File not found: ${node.filePath}`)
  }

  const content = fs.readFileSync(node.filePath, 'utf-8')
  const lines = content.split('\n')

  const startLine = node.line
  // If endLine is available, use it; otherwise read 50 lines from start
  const endLine = node.endLine !== undefined && node.endLine !== null
    ? node.endLine
    : Math.min(startLine + 50, lines.length - 1)

  // Clamp to valid range
  const from = Math.max(0, startLine)
  const to = Math.min(lines.length - 1, endLine)

  const sourceLines = lines.slice(from, to + 1)

  return {
    source: sourceLines.join('\n'),
    startLine: from,
    endLine: to,
    filePath: node.filePath,
  }
})

/**
 * Get rich hover info (doc comments + type inference) for a function node.
 * Uses LSP textDocument/hover.
 */
ipcMain.handle('get-hover-info', async (_event, nodeJson: string) => {
  if (!lspClient) {
    return { markdown: null, found: false }
  }

  const node = JSON.parse(nodeJson)

  if (!node.filePath || node.line === undefined) {
    return { markdown: null, found: false }
  }

  try {
    await lspClient.openDocument(node.filePath)

    const position = { line: node.line, character: node.character ?? 0 }
    const hover = await lspClient.getHover(node.filePath, position)

    if (!hover || !hover.contents) {
      return { markdown: null, found: false }
    }

    const markdown = extractHoverMarkdown(hover.contents)
    return { markdown, found: true }
  } catch (err) {
    console.error('[get-hover-info] Error:', err)
    return { markdown: null, found: false }
  } finally {
    try {
      await lspClient.closeDocument(node.filePath)
    } catch {
      // Ignore close errors
    }
  }
})

/**
 * Get the directory tree of a project.
 * Recursively reads the directory structure.
 */
ipcMain.handle('get-directory-tree', async (_event, projectPath: string) => {
  if (!projectPath || typeof projectPath !== 'string') {
    throw new Error('Invalid project path')
  }

  const fs = await import('fs')

  if (!fs.existsSync(projectPath)) {
    throw new Error(`Project path does not exist: ${projectPath}`)
  }

  const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'build', 'dist', '.cache'])
  const MAX_DEPTH = 10

  function buildTree(dirPath: string, depth: number): { name: string; path: string; isDirectory: boolean; children: any[]; isRustFile: boolean } {
    const name = path.basename(dirPath)
    const entries: any[] = []

    if (depth >= MAX_DEPTH) {
      return { name, path: dirPath, isDirectory: true, children: [], isRustFile: false }
    }

    try {
      const dirEntries = fs.readdirSync(dirPath, { withFileTypes: true })
      const sorted = dirEntries.sort((a: any, b: any) => {
        if (a.isDirectory() && !b.isDirectory()) return -1
        if (!a.isDirectory() && b.isDirectory()) return 1
        return a.name.localeCompare(b.name)
      })

      for (const entry of sorted) {
        const fullPath = path.join(dirPath, entry.name)
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue
          const child = buildTree(fullPath, depth + 1)
          if (child.children.length > 0) entries.push(child)
        } else if (entry.isFile()) {
          entries.push({
            name: entry.name,
            path: fullPath,
            isDirectory: false,
            children: [],
            isRustFile: entry.name.endsWith('.rs'),
          })
        }
      }
    } catch (err) {
      console.error(`[get-directory-tree] Error reading ${dirPath}:`, err)
    }

    return { name, path: dirPath, isDirectory: true, children: entries, isRustFile: false }
  }

  return buildTree(projectPath, 0)
})

/**
 * Shutdown LSP client.
 */
ipcMain.handle('shutdown-lsp', async () => {
  if (lspClient) {
    await lspClient.shutdown()
    lspClient = null
    graphBuilder = null
  }
  return { status: 'shutdown' }
})

/**
 * Extract a single markdown string from the LSP Hover response.
 * Handles all three formats: MarkupContent, MarkedString, and MarkedString[].
 */
function extractHoverMarkdown(contents: Hover['contents']): string {
  if (!contents) return ''

  // MarkupContent (preferred format from rust-analyzer)
  if (typeof contents === 'object' && 'kind' in contents && 'value' in contents) {
    return (contents as MarkupContent).value
  }

  // MarkedString[] — join all parts
  if (Array.isArray(contents)) {
    return contents.map(item => {
      if (typeof item === 'string') return item
      return item.value
    }).join('\n')
  }

  // Single MarkedString
  if (typeof contents === 'string') return contents
  // { language, value } object
  return (contents as { language: string; value: string }).value
}
