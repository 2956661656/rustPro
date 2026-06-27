import React from 'react'
import { useGraphStore } from '../store/useGraphStore'

// ─── Styles ──────────────────────────────────────────────────────────

const CONTAINER_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  textAlign: 'center',
  padding: '24px',
}

const ICON_STYLE: React.CSSProperties = {
  fontSize: '36px',
  marginBottom: '12px',
}

const TITLE_STYLE: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  color: '#eaeaea',
  marginBottom: '8px',
}

const SUBTITLE_STYLE: React.CSSProperties = {
  fontSize: '13px',
  color: '#888',
  maxWidth: '300px',
}

const ERROR_TEXT_STYLE: React.CSSProperties = {
  fontSize: '13px',
  color: '#e94560',
  maxWidth: '300px',
}

const PROGRESS_CONTAINER_STYLE: React.CSSProperties = {
  width: '200px',
  height: '6px',
  background: '#16213e',
  borderRadius: '3px',
  margin: '12px 0',
}

const PROGRESS_FILL_STYLE = (progress: number): React.CSSProperties => ({
  height: '100%',
  background: '#e94560',
  borderRadius: '3px',
  transition: 'width 0.3s',
  width: `${Math.max(0, Math.min(100, progress))}%`,
})

const LOADING_MESSAGE_STYLE: React.CSSProperties = {
  fontSize: '12px',
  color: '#888',
  marginTop: '4px',
}

const RETRY_BUTTON_STYLE: React.CSSProperties = {
  background: '#e94560',
  color: 'white',
  border: 'none',
  padding: '8px 16px',
  borderRadius: '4px',
  marginTop: '12px',
  cursor: 'pointer',
}

// ─── Spinner ──────────────────────────────────────────────────────────

const SPINNER_STYLE: React.CSSProperties = {
  width: '32px',
  height: '32px',
  border: '3px solid #16213e',
  borderTop: '3px solid #e94560',
  borderRadius: '50%',
  animation: 'spin 0.8s linear infinite',
}

const Spinner: React.FC = () => <div style={SPINNER_STYLE} />

// ─── Component ──────────────────────────────────────────────────────

const ProjectStatus: React.FC = () => {
  const analysisStatus = useGraphStore((s) => s.analysisStatus)
  const nodes = useGraphStore((s) => s.nodes)
  const error = useGraphStore((s) => s.error)
  const loadingProgress = useGraphStore((s) => s.loadingProgress)
  const loadingMessage = useGraphStore((s) => s.loadingMessage)

  // Early exit: ready state with data — ModuleList handles this
  if (analysisStatus === 'ready' && nodes.length > 0) {
    return null
  }

  const handleRetry = (): void => {
    useGraphStore.getState().setAnalysisStatus('idle')
  }

  // --- Analyzing state ---
  if (analysisStatus === 'analyzing') {
    return (
      <div style={CONTAINER_STYLE}>
        <Spinner />
        <div style={TITLE_STYLE}>Scanning project...</div>
        <div style={PROGRESS_CONTAINER_STYLE}>
          <div style={PROGRESS_FILL_STYLE(loadingProgress)} />
        </div>
        {loadingMessage && (
          <div style={LOADING_MESSAGE_STYLE}>{loadingMessage}</div>
        )}
      </div>
    )
  }

  // --- Error state ---
  if (analysisStatus === 'error') {
    return (
      <div style={CONTAINER_STYLE}>
        <div style={ICON_STYLE}>⚠️</div>
        <div style={TITLE_STYLE}>Analysis Error</div>
        {error && <div style={ERROR_TEXT_STYLE}>{error}</div>}
        <button style={RETRY_BUTTON_STYLE} onClick={handleRetry}>
          Retry
        </button>
      </div>
    )
  }

  // --- Ready (empty) state ---
  if (analysisStatus === 'ready' && nodes.length === 0) {
    return (
      <div style={CONTAINER_STYLE}>
        <div style={ICON_STYLE}>🔍</div>
        <div style={TITLE_STYLE}>No Rust functions discovered</div>
        <div style={SUBTITLE_STYLE}>
          Verify the project path contains .rs files with function definitions
        </div>
      </div>
    )
  }

  // --- Idle state (default) ---
  return (
    <div style={CONTAINER_STYLE}>
      <div style={ICON_STYLE}>📂</div>
      <div style={TITLE_STYLE}>
        Enter a project path and click Analyze to begin
      </div>
      <div style={SUBTITLE_STYLE}>
        Supports any Rust project with Cargo.toml
      </div>
    </div>
  )
}

export default ProjectStatus
