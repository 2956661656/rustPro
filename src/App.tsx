import { useState, useEffect, useRef, useCallback } from 'react'
import { useGraphStore } from './store/useGraphStore'
import { useLSPClient } from './hooks/useLSPClient'
import { GraphCanvas, SearchBar, ModuleList, ProjectStatus, NavigationHeader, TypeInfo, FunctionPreview, RightPanel } from './components'
import { getPathHistory, addToPathHistory } from './utils'
import type { FunctionNode } from './types/graph'

const App: React.FC = () => {
  const {
    nodes,
    selectedNodeId,
    isLoading,
    error,
    analysisStatus,
    focusNode,
    currentProjectPath,
  } = useGraphStore()

  const {
    analyzeProject,
    shutdownLSP,
    ping,
  } = useLSPClient()

  const [projectPath, setProjectPath] = useState('')
  const [pathHistory, setPathHistory] = useState<string[]>(() => getPathHistory())
  const [connected, setConnected] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [previewHeight, setPreviewHeight] = useState(200)
  const [showPreview, setShowPreview] = useState(true)
  const [showRightPanel, setShowRightPanel] = useState(false)
  const [rightPanelMode, setRightPanelMode] = useState<'expanded' | 'minimized'>('expanded')

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

  // Reopen preview when navigating to a new node
  useEffect(() => {
    if (selectedNodeId) {
      setShowPreview(true)
    }
  }, [selectedNodeId])

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
      addToPathHistory(projectPath.trim())
      setPathHistory(getPathHistory())
    } catch {
      // Error handled in store
    }
  }

  const handleNodeClick = useCallback((node: FunctionNode) => {
    console.log('[App] handleNodeClick:', node.name, node.filePath)
    focusNode(node.id)
  }, [focusNode])

  const handleToggleRightPanel = useCallback(() => {
    if (showRightPanel) {
      setShowRightPanel(false)
    } else {
      setShowRightPanel(true)
      setRightPanelMode('expanded')
    }
  }, [showRightPanel])

  const handleMinimizeRightPanel = useCallback(() => {
    setRightPanelMode('minimized')
  }, [])

  const handleCloseRightPanel = useCallback(() => {
    setShowRightPanel(false)
  }, [])

  const handleMinimizedClick = useCallback(() => {
    setRightPanelMode('expanded')
  }, [])

  const graphHeight = (analysisStatus === 'ready' && selectedNodeId && showPreview)
    ? dimensions.height - previewHeight
    : dimensions.height

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
            list="path-history"
          />
          <datalist id="path-history">
            {pathHistory.map(path => (
              <option key={path} value={path} />
            ))}
          </datalist>
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
        <button
          className={`btn-icon right-panel-toggle ${showRightPanel ? 'active' : ''}`}
          onClick={handleToggleRightPanel}
          title={showRightPanel ? 'Hide file tree' : 'Show file tree'}
        >
          📁
        </button>
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
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
              {/* Top: Graph with navigation and type info */}
              <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                <NavigationHeader />
                <TypeInfo node={nodes.find(n => n.id === selectedNodeId) ?? null} />
                  {dimensions.width > 0 && (
                    <GraphCanvas
                      width={dimensions.width}
                      height={graphHeight}
                      focusNodeId={selectedNodeId}
                      onNodeClick={handleNodeClick}
                    />
                  )}
              </div>
              {/* Bottom: Function Preview */}
              {showPreview && (
                <FunctionPreview
                  node={nodes.find(n => n.id === selectedNodeId) ?? null}
                  defaultHeight={200}
                  onHeightChange={setPreviewHeight}
                  onClose={() => setShowPreview(false)}
                />
              )}
            </div>
          )}
        </main>

        {/* Right panel */}
        {showRightPanel && (
          <RightPanel
            projectPath={currentProjectPath}
            mode={rightPanelMode}
            onClose={handleCloseRightPanel}
            onMinimize={handleMinimizeRightPanel}
          />
        )}
        {!showRightPanel && rightPanelMode === 'minimized' && (
          <RightPanel
            projectPath={currentProjectPath}
            mode="minimized"
            onClose={handleCloseRightPanel}
            onMinimize={handleMinimizedClick}
          />
        )}
      </div>
    </div>
  )
}

export default App
