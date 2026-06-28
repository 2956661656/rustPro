import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useGraphStore } from '../store/useGraphStore'
import { useDirectoryTree } from '../hooks/useDirectoryTree'
import FileTree from './FileTree'
import type { FileTreeNode } from '../types/directory'

// ─── Props ──────────────────────────────────────────────────────────

interface RightPanelProps {
  projectPath: string | null
  onClose: () => void
  onMinimize: () => void
  mode: 'expanded' | 'minimized'
}

// ─── Constants ──────────────────────────────────────────────────────

const DEFAULT_WIDTH = 280
const MIN_WIDTH = 200
const MAX_WIDTH = 500

const PANEL_CONTAINER_BASE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  background: '#1a1a2e',
  borderLeft: '1px solid #0f3460',
  position: 'relative',
  flexShrink: 0,
  overflow: 'hidden',
  height: '100%',
}

const MINIMIZED_STYLE: React.CSSProperties = {
  ...PANEL_CONTAINER_BASE,
  width: 32,
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
}

const HEADER_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  borderBottom: '1px solid #0f3460',
  background: '#16213e',
  flexShrink: 0,
}

const HEADER_TITLE: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#eaeaea',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

const HEADER_BTN: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#888',
  cursor: 'pointer',
  fontSize: 14,
  padding: '2px 6px',
  borderRadius: 3,
  lineHeight: 1,
}

const RESIZE_HANDLE: React.CSSProperties = {
  position: 'absolute',
  left: -4,
  top: 0,
  bottom: 0,
  width: 8,
  cursor: 'col-resize',
  zIndex: 10,
  background: 'transparent',
}

const LOADING_STYLE: React.CSSProperties = {
  padding: 24,
  textAlign: 'center',
  color: '#888',
  fontSize: 13,
}

const ERROR_STYLE: React.CSSProperties = {
  padding: 16,
  textAlign: 'center',
  color: '#ff6b6b',
  fontSize: 12,
}

const SPINNER_STYLE: React.CSSProperties = {
  display: 'inline-block',
  width: 20,
  height: 20,
  border: '2px solid #0f3460',
  borderTopColor: '#e94560',
  borderRadius: '50%',
  animation: 'edge-spin 0.8s linear infinite',
  marginBottom: 8,
}

// ─── Component ──────────────────────────────────────────────────────

const RightPanel: React.FC<RightPanelProps> = ({
  projectPath,
  onClose,
  onMinimize,
  mode,
}) => {
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const startXRef = useRef(0)
  const startWidthRef = useRef(DEFAULT_WIDTH)

  const nodes = useGraphStore(s => s.nodes)
  const focusNode = useGraphStore(s => s.focusNode)
  const setFileFilter = useGraphStore(s => s.setFileFilter)

  const { data, isLoading, error, refetch } = useDirectoryTree(
    mode === 'expanded' ? projectPath : null
  )

  // ── Drag resize ─────────────────────────────────────────────────

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    startXRef.current = e.clientX
    startWidthRef.current = width
  }, [width])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startXRef.current - e.clientX
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + delta))
      setWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  // ── File click handler: focus module / set search ───────────────

  const handleFileClick = useCallback((node: FileTreeNode) => {
    if (!node.isRustFile) return
    const matchingNodes = nodes.filter(n => n.filePath === node.path)
    if (matchingNodes.length > 0) {
      focusNode(matchingNodes[0].id)
      setFileFilter(node.path)
    }
  }, [nodes, focusNode, setFileFilter])

  // ── Minimized state ─────────────────────────────────────────────

  if (mode === 'minimized') {
    return (
      <div style={MINIMIZED_STYLE} onClick={onMinimize} title="Expand file tree">
        <span style={{ fontSize: 18, transform: 'rotate(90deg)', display: 'inline-block' }}>
          📁
        </span>
        <span style={{ fontSize: 10, color: '#888', writingMode: 'vertical-rl', marginTop: 8 }}>
          Files
        </span>
      </div>
    )
  }

  // ── Expanded state ──────────────────────────────────────────────

  return (
    <div ref={panelRef} style={{ ...PANEL_CONTAINER_BASE, width }}>
      {/* Resize handle */}
      <div
        style={RESIZE_HANDLE}
        onMouseDown={handleMouseDown}
        onMouseEnter={e => {
          (e.currentTarget as HTMLDivElement).style.background = 'rgba(233,69,96,0.3)'
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLDivElement).style.background = 'transparent'
        }}
      />

      {/* Header */}
      <div style={HEADER_STYLE}>
        <span style={HEADER_TITLE}>
          <span>📁</span>
          Project Files
        </span>
        <div style={{ display: 'flex', gap: 2 }}>
          <button
            style={HEADER_BTN}
            onClick={onMinimize}
            title="Minimize"
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.color = '#eaeaea'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.color = '#888'
            }}
          >
            ─
          </button>
          <button
            style={HEADER_BTN}
            onClick={onClose}
            title="Close"
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.color = '#e94560'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.color = '#888'
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      {isLoading && (
        <div style={LOADING_STYLE}>
          <div style={SPINNER_STYLE} />
          <div>Loading files...</div>
        </div>
      )}

      {error && (
        <div style={ERROR_STYLE}>
          <div style={{ marginBottom: 8 }}>⚠️ {error}</div>
          <button
            onClick={refetch}
            style={{
              background: '#e94560',
              color: 'white',
              border: 'none',
              padding: '4px 12px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Retry
          </button>
        </div>
      )}

      {!isLoading && !error && data && (
        <FileTree
          data={data}
          onFileClick={handleFileClick}
        />
      )}

      {!isLoading && !error && !data && (
        <div style={LOADING_STYLE}>
          {projectPath ? 'No project data' : 'Open a project to view files'}
        </div>
      )}
    </div>
  )
}

export default RightPanel
