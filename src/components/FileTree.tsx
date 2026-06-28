import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { useGraphStore } from '../store/useGraphStore'
import type { FileTreeNode } from '../types/directory'

// ─── Props ──────────────────────────────────────────────────────────

interface FileTreeProps {
  data: FileTreeNode
  onFileClick?: (node: FileTreeNode) => void
  languageFilter?: 'all' | 'rust'
}

// ─── Constants ──────────────────────────────────────────────────────

const CONTAINER_STYLE: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '4px 0',
}

const NODE_ROW_BASE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  cursor: 'pointer',
  userSelect: 'none',
  whiteSpace: 'nowrap',
  fontSize: 13,
  borderRadius: 2,
}

const ARROW_STYLE: React.CSSProperties = {
  display: 'inline-block',
  width: 16,
  textAlign: 'center',
  fontSize: 10,
  color: '#888',
  flexShrink: 0,
}

const FOLDER_ICON_STYLE: React.CSSProperties = {
  marginRight: 4,
  fontSize: 13,
}

const FILE_ICON_STYLE: React.CSSProperties = {
  marginRight: 4,
  fontSize: 13,
  width: 20,
  textAlign: 'center' as const,
}

const INDENT = 20

const FILTER_BAR_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  padding: '8px 10px',
  borderBottom: '1px solid #0f3460',
  alignItems: 'center',
}

const FILTER_BTN_BASE: React.CSSProperties = {
  padding: '3px 10px',
  borderRadius: 4,
  fontSize: 11,
  cursor: 'pointer',
  border: '1px solid #0f3460',
  background: '#16213e',
  color: '#888',
  transition: 'all 0.2s',
}

const FILTER_BTN_ACTIVE: React.CSSProperties = {
  ...FILTER_BTN_BASE,
  color: '#e94560',
  borderColor: '#e94560',
  background: 'rgba(233, 69, 96, 0.1)',
}

const EMPTY_STATE: React.CSSProperties = {
  padding: 32,
  textAlign: 'center',
  color: '#666',
  fontSize: 13,
}

// ─── Helpers ────────────────────────────────────────────────────────

function filterTree(node: FileTreeNode, filter: 'all' | 'rust'): FileTreeNode | null {
  if (filter === 'all') return node

  const filteredChildren: FileTreeNode[] = []
  for (const child of node.children) {
    if (child.isDirectory) {
      const filtered = filterTree(child, filter)
      if (filtered !== null && filtered.children.length > 0) {
        filteredChildren.push(filtered)
      }
    } else if (child.isRustFile) {
      filteredChildren.push(child)
    }
  }

  return { ...node, children: filteredChildren }
}

function collectAllDirPaths(node: FileTreeNode): string[] {
  const paths: string[] = []
  if (node.isDirectory) {
    paths.push(node.path)
    for (const child of node.children) {
      paths.push(...collectAllDirPaths(child))
    }
  }
  return paths
}

// ─── TreeNode Component (recursive) ─────────────────────────────────

interface TreeNodeProps {
  node: FileTreeNode
  depth: number
  onFileClick?: (node: FileTreeNode) => void
  collapsedSet: Set<string>
  toggleCollapse: (path: string) => void
  selectedPath: string | null
  setSelectedPath: (path: string | null) => void
}

const TreeNode: React.FC<TreeNodeProps> = React.memo(({
  node,
  depth,
  onFileClick,
  collapsedSet,
  toggleCollapse,
  selectedPath,
  setSelectedPath,
}) => {
  const isCollapsed = collapsedSet.has(node.path)
  const isSelected = selectedPath === node.path

  const nodeStyle: React.CSSProperties = {
    ...NODE_ROW_BASE,
    paddingLeft: 8 + depth * INDENT,
    ...(isSelected ? { background: 'rgba(233, 69, 96, 0.15)' } : {}),
  }

  const handleClick = useCallback(() => {
    setSelectedPath(node.path)
    if (node.isDirectory) {
      toggleCollapse(node.path)
    } else if (onFileClick) {
      onFileClick(node)
    }
  }, [node, onFileClick, toggleCollapse, setSelectedPath])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleClick()
    }
  }, [handleClick])

  return (
    <>
      <div
        style={nodeStyle}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role="treeitem"
        tabIndex={0}
        aria-expanded={node.isDirectory ? !isCollapsed : undefined}
        onMouseEnter={e => {
          if (!isSelected) {
            e.currentTarget.style.background = '#0f3460'
          }
        }}
        onMouseLeave={e => {
          if (!isSelected) {
            e.currentTarget.style.background = ''
          }
        }}
      >
        {node.isDirectory ? (
          <>
            <span style={ARROW_STYLE}>{isCollapsed ? '▸' : '▾'}</span>
            <span style={FOLDER_ICON_STYLE}>{isCollapsed ? '📁' : '📂'}</span>
            <span style={{ color: '#eaeaea' }}>{node.name}</span>
          </>
        ) : (
          <>
            <span style={{ ...FILE_ICON_STYLE, color: node.isRustFile ? '#e94560' : '#666' }}>
              {node.isRustFile ? '🦀' : '📄'}
            </span>
            <span style={{ color: node.isRustFile ? '#eaeaea' : '#888' }}>
              {node.name}
            </span>
          </>
        )}
      </div>
      {node.isDirectory && !isCollapsed && (
        <>
          {node.children.map(child => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onFileClick={onFileClick}
              collapsedSet={collapsedSet}
              toggleCollapse={toggleCollapse}
              selectedPath={selectedPath}
              setSelectedPath={setSelectedPath}
            />
          ))}
        </>
      )}
    </>
  )
})

TreeNode.displayName = 'TreeNode'

// ─── Main FileTree Component ───────────────────────────────────────

const FileTree: React.FC<FileTreeProps> = ({ data, onFileClick, languageFilter = 'all' }) => {
  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'rust'>(languageFilter)

  const toggleCollapse = useCallback((path: string) => {
    setCollapsedSet(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  // Filter the tree based on current filter mode
  const filteredData = useMemo(() => filterTree(data, filter), [data, filter])

  // Reset collapsed state and selection when filter or data changes
  useEffect(() => {
    if (!filteredData) return
    const allDirs = new Set(collectAllDirPaths(filteredData))
    setCollapsedSet(allDirs)
    setSelectedPath(null)
  }, [filteredData])

  // Pass through to parent; parent decides what to do per file type
  const handleFileClick = useCallback((node: FileTreeNode) => {
    if (onFileClick) {
      onFileClick(node)
    }
  }, [onFileClick])

  if (!filteredData || filteredData.children.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={FILTER_BAR_STYLE}>
          <span style={{ fontSize: 11, color: '#888' }}>Show:</span>
          <button
            style={filter === 'all' ? FILTER_BTN_ACTIVE : FILTER_BTN_BASE}
            onClick={() => setFilter('all')}
          >
            All files
          </button>
          <button
            style={filter === 'rust' ? FILTER_BTN_ACTIVE : FILTER_BTN_BASE}
            onClick={() => setFilter('rust')}
          >
            Only .rs
          </button>
        </div>
        <div style={EMPTY_STATE}>No files to display</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={FILTER_BAR_STYLE}>
        <span style={{ fontSize: 11, color: '#888' }}>Show:</span>
        <button
          style={filter === 'all' ? FILTER_BTN_ACTIVE : FILTER_BTN_BASE}
          onClick={() => setFilter('all')}
        >
          All files
        </button>
        <button
          style={filter === 'rust' ? FILTER_BTN_ACTIVE : FILTER_BTN_BASE}
          onClick={() => setFilter('rust')}
        >
          Only .rs
        </button>
      </div>
      <div style={CONTAINER_STYLE} role="tree">
        {filteredData.children.map(child => (
          <TreeNode
            key={child.path}
            node={child}
            depth={0}
            onFileClick={handleFileClick}
            collapsedSet={collapsedSet}
            toggleCollapse={toggleCollapse}
            selectedPath={selectedPath}
            setSelectedPath={setSelectedPath}
          />
        ))}
      </div>
    </div>
  )
}

export default FileTree
