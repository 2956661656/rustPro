import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { FunctionNode } from '../types/graph'
import { getDisplayName } from '../types/graph'

interface FunctionPreviewProps {
  node: FunctionNode | null
  defaultHeight?: number
  onHeightChange?: (height: number) => void
  onClose?: () => void
}

const PREVIEW_CONTAINER_STYLE: React.CSSProperties = {
  borderTop: '1px solid #0f3460',
  background: '#12122a',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  position: 'relative',
}

const HEADER_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 12px',
  background: '#16213e',
  borderBottom: '1px solid #0f3460',
  flexShrink: 0,
}

const HEADER_TITLE_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: '#e94560',
  fontWeight: 600,
  fontFamily: 'monospace',
}

const HEADER_FILE_STYLE: React.CSSProperties = {
  fontSize: 11,
  color: '#888',
  marginLeft: 8,
}

const CODE_CONTAINER_STYLE: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: 0,
  fontFamily: "'SF Mono', 'Fira Code', 'Consolas', monospace",
  fontSize: 12,
  lineHeight: 1.5,
  tabSize: 4,
}

const LINE_NUMBER_STYLE: React.CSSProperties = {
  color: '#555',
  textAlign: 'right',
  paddingRight: 12,
  userSelect: 'none',
  minWidth: 32,
  borderRight: '1px solid #1a1a3e',
  marginRight: 12,
}

const CODE_LINE_STYLE: React.CSSProperties = {
  whiteSpace: 'pre',
  color: '#e0e0e0',
}

const DRAG_HANDLE_STYLE: React.CSSProperties = {
  height: 4,
  background: '#0f3460',
  cursor: 'row-resize',
  flexShrink: 0,
  position: 'relative',
}

const EMPTY_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  color: '#555',
  fontSize: 13,
}

const LOADING_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  color: '#888',
  fontSize: 12,
}

const FunctionPreview: React.FC<FunctionPreviewProps> = ({ node, defaultHeight = 200, onHeightChange, onClose }) => {
  const [source, setSource] = useState<string | null>(null)
  const [sourceStartLine, setSourceStartLine] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [height, setHeight] = useState(defaultHeight)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartHeight = useRef(0)

  // Fetch source when node changes
  useEffect(() => {
    if (!node) {
      setSource(null)
      setError(null)
      return
    }

    setIsLoading(true)
    setError(null)

    window.electronAPI.getFunctionSource(JSON.stringify(node))
      .then((result) => {
        setSource(result.source)
        setSourceStartLine(result.startLine)
        setIsLoading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setIsLoading(false)
      })
  }, [node])

  // Drag handling
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    dragStartY.current = e.clientY
    dragStartHeight.current = height
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const delta = dragStartY.current - e.clientY
      const newHeight = Math.max(100, Math.min(600, dragStartHeight.current + delta))
      setHeight(newHeight)
    }

    const handleMouseUp = () => {
      isDragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [height])

  // Report height changes to parent
  useEffect(() => {
    if (onHeightChange) onHeightChange(height)
  }, [height, onHeightChange])

  if (!node) return null

  const renderSource = () => {
    if (isLoading) {
      return <div style={LOADING_STYLE}>Loading source...</div>
    }

    if (error) {
      return <div style={{ ...EMPTY_STYLE, color: '#e94560' }}>Error: {error}</div>
    }

    if (!source) {
      return <div style={EMPTY_STYLE}>No source available</div>
    }

    const lines = source.split('\n')

    return (
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td style={LINE_NUMBER_STYLE}>{sourceStartLine + i + 1}</td>
              <td style={CODE_LINE_STYLE}>{line || ' '}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{ ...PREVIEW_CONTAINER_STYLE, height }}
    >
      {/* Drag handle */}
      <div
        style={DRAG_HANDLE_STYLE}
        onMouseDown={handleMouseDown}
      />

      {/* Header */}
      <div style={HEADER_STYLE}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={HEADER_TITLE_STYLE}>{getDisplayName(node)}</span>
          <span style={HEADER_FILE_STYLE}>
            {node.filePath.split('/').pop()}:{node.line + 1}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className="btn-icon"
            onClick={() => {
              if (source) navigator.clipboard.writeText(source)
            }}
            title="Copy source"
            style={{ fontSize: 13, padding: '0 4px' }}
          >
            📋
          </button>
          <button
            className="btn-icon"
            onClick={onClose}
            title="Close preview"
            style={{ fontSize: 15, padding: '0 4px', color: '#888', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Code */}
      <div style={CODE_CONTAINER_STYLE}>
        {renderSource()}
      </div>
    </div>
  )
}

export default FunctionPreview
