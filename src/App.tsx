import { useState, useEffect, useRef, useCallback } from 'react'
import { useGraphStore } from './store/useGraphStore'
import { useLSPClient } from './hooks/useLSPClient'
import { GraphCanvas, SearchBar, ModuleList, ProjectStatus, NavigationHeader, TypeInfo } from './components'
import type { FunctionNode } from './types/graph'

const App: React.FC = () => {
  const {
    nodes,
    selectedNodeId,
    isLoading,
    error,
    analysisStatus,
    focusNode,
  } = useGraphStore()

  const {
    analyzeProject,
    shutdownLSP,
    ping,
  } = useLSPClient()

  const [projectPath, setProjectPath] = useState('')
  const [connected, setConnected] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })

  // Resize observer
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        setDimensions({
          width: Math.floor(entry.contentRect.width),
          height: Math.floor(entry.contentRect.height),
        })
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Test connection on mount
  useEffect(() => {
    ping()
      .then(() => setConnected(true))
      .catch(() => setConnected(false))
  }, [ping])

  const handleAnalyze = async () => {
    if (!projectPath.trim()) return
    console.log('[App] analyzeProject:', projectPath.trim())
    try {
      await analyzeProject(projectPath.trim())
    } catch {
      // Error handled in store
    }
  }

  const handleNodeClick = useCallback((node: FunctionNode) => {
    console.log('[App] handleNodeClick:', node.name, node.filePath)
    focusNode(node.id)
  }, [focusNode])

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <h1>Rust Call Graph Analyzer</h1>
        <div className="header-controls">
          <input
            type="text"
            placeholder="Project path..."
            value={projectPath}
            onChange={e => setProjectPath(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
            className="path-input"
          />
          <button onClick={handleAnalyze} disabled={isLoading}>
            {isLoading ? 'Analyzing...' : 'Analyze'}
          </button>
          {analysisStatus === 'ready' && (
            <button onClick={() => shutdownLSP()} className="btn-secondary">
              Close
            </button>
          )}
        </div>
        <span className={`status ${connected ? 'connected' : ''}`}>
          {connected ? 'LSP ready' : 'disconnected'}
        </span>
      </header>

      {/* Error toast */}
      {error && (
        <div className="error-toast">
          <span>{error}</span>
          <button onClick={() => useGraphStore.getState().setError(null)}>×</button>
        </div>
      )}

      {/* Main layout */}
      <div className="app-layout">
        {/* Left Sidebar */}
        <aside className="sidebar" style={{ width: 300, minWidth: 300, maxWidth: 300 }}>
          <SearchBar />
          <ModuleList />
        </aside>

        {/* Main area */}
        <main className="graph-area" ref={containerRef}>
          <ProjectStatus />

          {analysisStatus === 'ready' && !selectedNodeId && (
            <div className="empty-state">
              <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
              <h2>Select a function</h2>
              <p>Choose a function from the sidebar to view its call relations</p>
            </div>
          )}

          {analysisStatus === 'ready' && selectedNodeId && (
            <NavigationHeader />
          )}
          {analysisStatus === 'ready' && selectedNodeId && (
            <TypeInfo node={nodes.find(n => n.id === selectedNodeId) ?? null} />
          )}
          {analysisStatus === 'ready' && selectedNodeId && dimensions.width > 0 && (
            <GraphCanvas
              width={dimensions.width}
              height={dimensions.height}
              focusNodeId={selectedNodeId}
              onNodeClick={handleNodeClick}
            />
          )}
        </main>
      </div>
    </div>
  )
}

export default App
