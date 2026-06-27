import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { LSPClient } from './lsp/client'
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
