import React from 'react'

interface EdgeStateOverlayProps {
  isLoading: boolean
  hasError: string | null
  nodeCount: number
  edgeCount: number
  focusNodeName: string
  onRetry: () => void
  loadingMessage?: string
}

const EdgeStateOverlay: React.FC<EdgeStateOverlayProps> = ({
  isLoading,
  hasError,
  nodeCount,
  edgeCount,
  focusNodeName,
  onRetry,
  loadingMessage,
}) => {
  // ── State 1: Loading (initial or recursive) ────────────────────
  if (isLoading) {
    return (
      <div className="edge-state-overlay">
        <div className="edge-state-spinner" />
        <div className="edge-state-msg">
          {loadingMessage || `Loading call relations for ${focusNodeName}...`}
        </div>
      </div>
    )
  }

  // ── State 2: No edges found for the focus node ─────────────────
  if (nodeCount > 1 && edgeCount === 0 && !isLoading && !hasError) {
    return (
      <div className="edge-state-overlay">
        <div className="edge-state-icon">🔗</div>
        <div className="edge-state-msg">
          {focusNodeName} has no callers or callees in the project
        </div>
      </div>
    )
  }

  // ── State 3: Error loading edges ───────────────────────────────
  if (hasError) {
    return (
      <div className="edge-state-overlay">
        <div className="edge-state-icon">⚠️</div>
        <div className="edge-state-msg">
          Could not load edges for {focusNodeName}
        </div>
        <div className="edge-state-sub">{hasError}</div>
        <button className="edge-state-retry" onClick={onRetry}>
          Retry
        </button>
      </div>
    )
  }

  // ── State 4: No overlay needed ─────────────────────────────────
  return null
}

export default EdgeStateOverlay
