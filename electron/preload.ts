import { contextBridge, ipcRenderer } from 'electron'

type ProgressCallback = (progress: number, message: string) => void
type ErrorCallback = (error: string) => void

const progressListeners: ProgressCallback[] = []
const errorListeners: ErrorCallback[] = []

ipcRenderer.on('analysis-progress', (_event, progress: number, message: string) => {
  progressListeners.forEach(cb => cb(progress, message))
})

ipcRenderer.on('analysis-error', (_event, error: string) => {
  errorListeners.forEach(cb => cb(error))
})

contextBridge.exposeInMainWorld('electronAPI', {
  // Health check
  ping: () => ipcRenderer.invoke('ping'),

  // Project analysis (Phase 3)
  analyzeProject: (projectPath: string) => ipcRenderer.invoke('analyze-project', projectPath),

  // Edge loading (Phase 6)
  getEdgesForNode: (nodeJson: string) => ipcRenderer.invoke('get-edges-for-node', nodeJson),
  getEdgesForNodes: (nodesJson: string) => ipcRenderer.invoke('get-edges-for-nodes', nodesJson),

  // Complete graph
  getCompleteGraph: (projectPath: string) => ipcRenderer.invoke('get-complete-graph', projectPath),

  // Directory tree
  getDirectoryTree: (projectPath: string) => ipcRenderer.invoke('get-directory-tree', projectPath),

  // Function stats
  getFunctionStats: (nodeJson: string) => ipcRenderer.invoke('get-function-stats', nodeJson),

  // Function source preview
  getFunctionSource: (nodeJson: string) => ipcRenderer.invoke('get-function-source', nodeJson),

  // Hover info
  getHoverInfo: (nodeJson: string) => ipcRenderer.invoke('get-hover-info', nodeJson),

  // Cleanup
  shutdownLSP: () => ipcRenderer.invoke('shutdown-lsp'),

  // Progress and error subscriptions (returns cleanup function)
  onProgress: (callback: ProgressCallback) => {
    progressListeners.push(callback)
    return () => {
      const idx = progressListeners.indexOf(callback)
      if (idx >= 0) progressListeners.splice(idx, 1)
    }
  },

  onError: (callback: ErrorCallback) => {
    errorListeners.push(callback)
    return () => {
      const idx = errorListeners.indexOf(callback)
      if (idx >= 0) errorListeners.splice(idx, 1)
    }
  },

  logToFile: (level: string, message: string) => {
    ipcRenderer.send('log-message', level, message)
  },
})
