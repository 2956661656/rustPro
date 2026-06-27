import React, { useState } from 'react'
import type { FunctionNode } from '../types/graph'

interface TypeInfoProps {
  node: FunctionNode | null
}

const CONTAINER_STYLE: React.CSSProperties = {
  marginTop: 4,
  marginLeft: 16,
  marginRight: 16,
  fontSize: 12,
}

const SUMMARY_STYLE: React.CSSProperties = {
  cursor: 'pointer',
  color: '#888',
  padding: '4px 8px',
  background: '#16213e',
  borderRadius: 4,
  outline: 'none',
  userSelect: 'none',
}

const DETAILS_OPEN_STYLE: React.CSSProperties = {
  padding: 8,
  background: '#0f3460',
  borderRadius: '0 0 4px 4px',
}

const CODE_STYLE: React.CSSProperties = {
  fontFamily: 'monospace',
  color: '#e94560',
}

const LABEL_STYLE: React.CSSProperties = {
  color: '#888',
}

const ROW_STYLE: React.CSSProperties = {
  marginBottom: 4,
}

/**
 * Build a human-readable signature from parsed type info.
 */
function buildSignature(node: FunctionNode): string {
  const params = node.parameterTypes.length > 0 ? node.parameterTypes.join(', ') : ''
  const ret = node.returnType ? ` -> ${node.returnType}` : ''
  return `fn ${node.name}(${params})${ret}`
}

const TypeInfo: React.FC<TypeInfoProps> = ({ node }) => {
  const [open, setOpen] = useState(false)

  if (!node) return null

  // If there are no parameter types and no return type, nothing useful to show
  if (node.parameterTypes.length === 0 && node.returnType === null) return null

  const signature = buildSignature(node)

  return (
    <details
      className="type-info"
      style={CONTAINER_STYLE}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary
        className="type-summary"
        style={SUMMARY_STYLE}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#0f3460' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = '#16213e' }}
      >
        📋 {signature}
      </summary>
      <div className="type-detail" style={DETAILS_OPEN_STYLE}>
        {node.parameterTypes.map((param, i) => {
          const colonIdx = param.indexOf(':')
          const name = colonIdx > 0 ? param.slice(0, colonIdx).trim() : `param${i + 1}`
          const typeStr = colonIdx > 0 ? param.slice(colonIdx + 1).trim() : param
          return (
            <div key={i} style={ROW_STYLE}>
              <span style={LABEL_STYLE}>{name}:</span>{' '}
              <code style={CODE_STYLE}>{typeStr}</code>
            </div>
          )
        })}
        {node.returnType && (
          <div style={ROW_STYLE}>
            <span style={LABEL_STYLE}>Returns:</span>{' '}
            <code style={CODE_STYLE}>{node.returnType}</code>
          </div>
        )}
      </div>
    </details>
  )
}

export default TypeInfo
