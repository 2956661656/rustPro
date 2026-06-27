import React from 'react'
import { useGraphStore } from '../store/useGraphStore'

const NavigationHeader: React.FC = () => {
  const selectedNodeId = useGraphStore(s => s.selectedNodeId)
  const nodes = useGraphStore(s => s.nodes)
  const focusHistory = useGraphStore(s => s.focusHistory)
  const goBack = useGraphStore(s => s.goBack)

  const focusNode = nodes.find(n => n.id === selectedNodeId)

  // ── Early exit: nothing to render without a focused node ──────
  if (!focusNode) return null

  return (
    <div className="nav-header">
      <button
        className="nav-back-btn"
        disabled={focusHistory.length === 0}
        onClick={goBack}
        aria-label="Go back"
      >
        ←
      </button>
      <span className="nav-breadcrumb">
        {focusNode.module}
        {' > '}
        <span className="nav-func-name">{focusNode.name}</span>
      </span>
    </div>
  )
}

export default NavigationHeader
