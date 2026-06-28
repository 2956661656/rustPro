import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useGraphStore } from '../store/useGraphStore'
import type { FunctionNode } from '../types/graph'
import { getDisplayName } from '../types/graph'

// ─── Types ──────────────────────────────────────────────────────────

interface ModuleGroup {
  module: string
  nodes: FunctionNode[]
}

// ─── Constants ──────────────────────────────────────────────────────

const CONTAINER_STYLE: React.CSSProperties = {
  maxHeight: '100%',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
}

const EMPTY_STATE_STYLE: React.CSSProperties = {
  padding: '24px 12px',
  color: '#888',
  fontSize: '14px',
  textAlign: 'center',
}

const MODULE_HEADER_STYLE: React.CSSProperties = {
  background: '#16213e',
  padding: '8px 12px',
  cursor: 'pointer',
  borderBottom: '1px solid #0f3460',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  userSelect: 'none',
}

const MODULE_NAME_STYLE: React.CSSProperties = {
  color: '#eaeaea',
  fontSize: '13px',
  fontWeight: 600,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
}

const COUNT_BADGE_STYLE: React.CSSProperties = {
  background: '#e94560',
  color: 'white',
  borderRadius: 8,
  padding: '1px 6px',
  fontSize: 11,
  fontWeight: 600,
  minWidth: 18,
  textAlign: 'center',
  marginLeft: 8,
  flexShrink: 0,
}

const FUNCTION_LIST_STYLE: React.CSSProperties = {
  overflow: 'hidden',
}

const FUNCTION_LIST_SCROLLABLE_STYLE: React.CSSProperties = {
  maxHeight: 260,
  overflowY: 'auto',
}

const FUNCTION_ITEM_BASE: React.CSSProperties = {
  padding: '6px 12px 6px 20px',
  cursor: 'pointer',
  borderBottom: '1px solid #1a1a2e',
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 4,
}

const FUNCTION_ITEM_SELECTED: React.CSSProperties = {
  background: 'rgba(233, 69, 96, 0.15)',
  borderLeft: '3px solid #e94560',
}

const FUNCTION_NAME_STYLE: React.CSSProperties = {
  fontWeight: 600,
  color: '#eaeaea',
  fontSize: 13,
}

const FILE_LOCATION_STYLE: React.CSSProperties = {
  fontSize: 11,
  color: '#888',
  marginLeft: 8,
}

const ENTRY_BADGE_STYLE: React.CSSProperties = {
  background: '#00b894',
  color: 'white',
  borderRadius: 4,
  padding: '0 4px',
  fontSize: 10,
  fontWeight: 600,
  marginLeft: 6,
  lineHeight: '16px',
}

const VIEW_TOGGLE_BAR: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: '6px 10px',
  borderBottom: '1px solid #0f3460',
  background: '#1a1a2e',
  flexShrink: 0,
}

const VIEW_TOGGLE_BTN_BASE: React.CSSProperties = {
  padding: '3px 8px',
  borderRadius: 4,
  fontSize: 11,
  cursor: 'pointer',
  border: '1px solid #0f3460',
  background: '#16213e',
  color: '#888',
  transition: 'all 0.2s',
  lineHeight: 1,
}

const VIEW_TOGGLE_BTN_ACTIVE: React.CSSProperties = {
  ...VIEW_TOGGLE_BTN_BASE,
  color: '#e94560',
  borderColor: '#e94560',
  background: 'rgba(233, 69, 96, 0.1)',
}

const FILTER_BANNER: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 10px',
  background: 'rgba(233, 69, 96, 0.08)',
  borderBottom: '1px solid rgba(233, 69, 96, 0.2)',
  fontSize: 11,
  color: '#e94560',
  flexShrink: 0,
}

const CLEAR_BTN: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#e94560',
  cursor: 'pointer',
  fontSize: 14,
  padding: '2px 6px',
  borderRadius: 3,
  lineHeight: 1,
}

const SCROLLBAR_STYLES = `
  .module-list-container::-webkit-scrollbar {
    width: 6px;
  }
  .module-list-container::-webkit-scrollbar-track {
    background: #1a1a2e;
  }
  .module-list-container::-webkit-scrollbar-thumb {
    background: #e94560;
    border-radius: 3px;
  }
  .module-list-fn-scroll::-webkit-scrollbar {
    width: 5px;
  }
  .module-list-fn-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  .module-list-fn-scroll::-webkit-scrollbar-thumb {
    background: #e94560;
    border-radius: 2px;
  }
`

// ─── Helpers ────────────────────────────────────────────────────────

function isEntryPoint(node: FunctionNode): boolean {
  return node.fanIn === 0 && node.fanOut > 0
}

function matchesQuery(node: FunctionNode, query: string): boolean {
  const q = query.toLowerCase()
  return (
    node.name.toLowerCase().includes(q) ||
    node.module.toLowerCase().includes(q) ||
    node.filePath.toLowerCase().includes(q)
  )
}

function groupNodesByModule(nodes: FunctionNode[]): ModuleGroup[] {
  const moduleMap = new Map<string, FunctionNode[]>()

  for (const node of nodes) {
    const key = node.module.toLowerCase()
    const existing = moduleMap.get(key)
    if (existing) {
      existing.push(node)
    } else {
      moduleMap.set(key, [node])
    }
  }

  const groups: ModuleGroup[] = []
  for (const [, groupNodes] of moduleMap) {
    const displayModule = groupNodes[0].module
    const sorted = [...groupNodes].sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    )
    groups.push({ module: displayModule, nodes: sorted })
  }

  groups.sort((a, b) =>
    a.module.toLowerCase().localeCompare(b.module.toLowerCase())
  )

  return groups
}

type ViewMode = 'module' | 'file' | 'flat'

interface FileGroup {
  filePath: string
  fileName: string
  nodes: FunctionNode[]
}

function groupNodesByFile(nodes: FunctionNode[]): FileGroup[] {
  const fileMap = new Map<string, FunctionNode[]>()
  for (const node of nodes) {
    const existing = fileMap.get(node.filePath)
    if (existing) {
      existing.push(node)
    } else {
      fileMap.set(node.filePath, [node])
    }
  }

  const groups: FileGroup[] = []
  for (const [filePath, groupNodes] of fileMap) {
    const fileName = filePath.split('/').pop() || filePath
    const sorted = [...groupNodes].sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    )
    groups.push({ filePath, fileName, nodes: sorted })
  }

  groups.sort((a, b) => a.filePath.localeCompare(b.filePath))
  return groups
}

function flattenNodes(nodes: FunctionNode[]): FunctionNode[] {
  return [...nodes].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  )
}

// ─── Component ──────────────────────────────────────────────────────

const ModuleList: React.FC = () => {
  const allNodes = useGraphStore(s => s.nodes)
  const searchQuery = useGraphStore(s => s.searchQuery)
  const selectedNodeId = useGraphStore(s => s.selectedNodeId)
  const showExternal = useGraphStore(s => s.showExternal)
  const fileFilter = useGraphStore(s => s.fileFilter)
  const focusNode = useGraphStore(s => s.focusNode)
  const setFileFilter = useGraphStore(s => s.setFileFilter)

  const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<ViewMode>('module')
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const toggleCollapse = useCallback((module: string) => {
    setCollapsedModules(prev => {
      const next = new Set(prev)
      if (next.has(module)) {
        next.delete(module)
      } else {
        next.add(module)
      }
      return next
    })
  }, [])

  // Step 1: Filter by user code (respect showExternal)
  const userNodes = useMemo(() => {
    if (showExternal) return allNodes
    return allNodes.filter(n => n.isUserCode)
  }, [allNodes, showExternal])

  // Step 2: Filter by file path (when a file is clicked in right panel)
  const filteredNodes = useMemo(() => {
    if (!fileFilter) return userNodes
    return userNodes.filter(n => n.filePath === fileFilter)
  }, [userNodes, fileFilter])

  // Step 3: Further filter by search query
  const finalNodes = useMemo(() => {
    const trimmed = searchQuery.trim()
    if (!trimmed) return filteredNodes
    return filteredNodes.filter(n => matchesQuery(n, trimmed))
  }, [filteredNodes, searchQuery])

  // Derive the filtered file name for the banner
  const filterFileName = useMemo(() => {
    if (!fileFilter) return null
    return fileFilter.split('/').pop() || fileFilter
  }, [fileFilter])

  // Auto-expand module and scroll to selected node
  useEffect(() => {
    if (!selectedNodeId) return
    const selectedNode = finalNodes.find(n => n.id === selectedNodeId)
    if (!selectedNode) return
    // Ensure the containing module is expanded
    setCollapsedModules(prev => {
      if (!prev.has(selectedNode.module)) return prev
      const next = new Set(prev)
      next.delete(selectedNode.module)
      return next
    })
    // Scroll to the element after a short delay to let DOM update
    setTimeout(() => {
      const el = itemRefs.current.get(selectedNodeId)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }
    }, 50)
  }, [selectedNodeId, finalNodes])

  // ── Derived state: groups by view mode ─────────────────────────
  const moduleGroups = useMemo(() => {
    if (finalNodes.length === 0 || viewMode !== 'module') return [] as ModuleGroup[]
    return groupNodesByModule(finalNodes)
  }, [finalNodes, viewMode])

  const fileGroups = useMemo(() => {
    if (finalNodes.length === 0 || viewMode !== 'file') return [] as FileGroup[]
    return groupNodesByFile(finalNodes)
  }, [finalNodes, viewMode])

  const flatNodes = useMemo(() => {
    if (finalNodes.length === 0 || viewMode !== 'flat') return [] as FunctionNode[]
    return flattenNodes(finalNodes)
  }, [finalNodes, viewMode])

  // ── Early exit: empty state ─────────────────────────────────────
  if (finalNodes.length === 0) {
    return (
      <div style={EMPTY_STATE_STYLE}>
        {fileFilter ? 'No functions in this file' : 'No functions discovered'}
      </div>
    )
  }

  // ── Render ──────────────────────────────────────────────────────
  return (
    <>
      <style>{SCROLLBAR_STYLES}</style>

      {/* File filter banner */}
      {fileFilter && (
        <div style={FILTER_BANNER}>
          <span>
            📄 <strong>{filterFileName}</strong> ({finalNodes.length} functions)
          </span>
          <button
            style={CLEAR_BTN}
            onClick={() => setFileFilter(null)}
            title="Show all functions"
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#fff' }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#e94560' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* View mode toggle */}
      <div style={VIEW_TOGGLE_BAR}>
        <button
          style={viewMode === 'module' ? VIEW_TOGGLE_BTN_ACTIVE : VIEW_TOGGLE_BTN_BASE}
          onClick={() => setViewMode('module')}
          title="Group by module"
        >
          📦 Module
        </button>
        <button
          style={viewMode === 'file' ? VIEW_TOGGLE_BTN_ACTIVE : VIEW_TOGGLE_BTN_BASE}
          onClick={() => setViewMode('file')}
          title="Group by file"
        >
          📁 File
        </button>
        <button
          style={viewMode === 'flat' ? VIEW_TOGGLE_BTN_ACTIVE : VIEW_TOGGLE_BTN_BASE}
          onClick={() => setViewMode('flat')}
          title="Flat list"
        >
          📋 Flat
        </button>
      </div>

      <div className="module-list-container" style={CONTAINER_STYLE}>
        {/* Module view */}
        {viewMode === 'module' && moduleGroups.map(group => {
          const isCollapsed = collapsedModules.has(group.module)
          const hasSelectedChild = group.nodes.some(n => n.id === selectedNodeId)
          const moduleHeaderStyle: React.CSSProperties = {
            ...MODULE_HEADER_STYLE,
            ...(hasSelectedChild ? { background: 'rgba(233, 69, 96, 0.1)', borderLeft: '3px solid #e94560' } : {}),
          }

          return (
            <div key={group.module}>
              {/* Module header */}
              <div
                style={moduleHeaderStyle}
                onClick={() => toggleCollapse(group.module)}
                role="button"
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleCollapse(group.module)
                  }
                }}
                aria-expanded={!isCollapsed}
              >
                <span style={MODULE_NAME_STYLE} title={group.module}>
                  {group.module}
                </span>
                <span style={COUNT_BADGE_STYLE}>
                  {group.nodes.length}
                </span>
              </div>

              {/* Function list (collapsible) */}
              {!isCollapsed && (
                <div style={FUNCTION_LIST_STYLE}>
                  <div className="module-list-fn-scroll" style={FUNCTION_LIST_SCROLLABLE_STYLE}>
                    {group.nodes.map(node => {
                      const isSelected = node.id === selectedNodeId
                      const entry = isEntryPoint(node)

                      const itemStyle: React.CSSProperties = {
                        ...FUNCTION_ITEM_BASE,
                        ...(isSelected ? FUNCTION_ITEM_SELECTED : {}),
                      }

                      return (
                        <div
                          key={node.id}
                          ref={el => {
                            if (el) itemRefs.current.set(node.id, el)
                            else itemRefs.current.delete(node.id)
                          }}
                          style={itemStyle}
                          onClick={() => {
                            focusNode(node.id)
                            // Clear file filter when user manually clicks a function outside the filtered context
                          }}
                          onMouseEnter={e => {
                            if (!isSelected) {
                              (e.currentTarget as HTMLDivElement).style.background = '#0f3460'
                            }
                          }}
                          onMouseLeave={e => {
                            if (!isSelected) {
                              (e.currentTarget as HTMLDivElement).style.background = ''
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              focusNode(node.id)
                            }
                          }}
                        >
                          <span style={FUNCTION_NAME_STYLE}>
                            {getDisplayName(node)}
                          </span>
                          <span style={FILE_LOCATION_STYLE}>
                            {node.filePath.split('/').pop()}:{node.line}
                          </span>
                          {entry && (
                            <span style={ENTRY_BADGE_STYLE}>entry</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {/* File view */}
        {viewMode === 'file' && fileGroups.map(group => {
          const isCollapsed = collapsedModules.has(group.filePath)
          const hasSelectedChild = group.nodes.some(n => n.id === selectedNodeId)
          const headerStyle: React.CSSProperties = {
            ...MODULE_HEADER_STYLE,
            ...(hasSelectedChild ? { background: 'rgba(233, 69, 96, 0.1)', borderLeft: '3px solid #e94560' } : {}),
          }
          return (
            <div key={group.filePath}>
              <div
                style={headerStyle}
                onClick={() => toggleCollapse(group.filePath)}
                role="button"
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    toggleCollapse(group.filePath)
                  }
                }}
                aria-expanded={!isCollapsed}
              >
                <span style={MODULE_NAME_STYLE} title={group.filePath}>
                  📄 {group.fileName}
                </span>
                <span style={COUNT_BADGE_STYLE}>{group.nodes.length}</span>
              </div>
              {!isCollapsed && (
                <div style={FUNCTION_LIST_STYLE}>
                  <div className="module-list-fn-scroll" style={FUNCTION_LIST_SCROLLABLE_STYLE}>
                    {group.nodes.map(node => {
                      const isSelected = node.id === selectedNodeId
                      const entry = isEntryPoint(node)
                      const itemStyle: React.CSSProperties = {
                        ...FUNCTION_ITEM_BASE,
                        ...(isSelected ? FUNCTION_ITEM_SELECTED : {}),
                      }
                      return (
                        <div
                          key={node.id}
                          ref={el => {
                            if (el) itemRefs.current.set(node.id, el)
                            else itemRefs.current.delete(node.id)
                          }}
                          style={itemStyle}
                          onClick={() => focusNode(node.id)}
                          onMouseEnter={e => {
                            if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = '#0f3460'
                          }}
                          onMouseLeave={e => {
                            if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = ''
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusNode(node.id) }
                          }}
                        >
                          <span style={FUNCTION_NAME_STYLE}>{getDisplayName(node)}</span>
                          <span style={FILE_LOCATION_STYLE}>{node.filePath.split('/').pop()}:{node.line}</span>
                          {entry && <span style={ENTRY_BADGE_STYLE}>entry</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {/* Flat view */}
        {viewMode === 'flat' && (
          <div className="module-list-fn-scroll" style={{ overflowY: 'auto', flex: 1 }}>
            {flatNodes.map(node => {
              const isSelected = node.id === selectedNodeId
              const entry = isEntryPoint(node)
              const itemStyle: React.CSSProperties = {
                ...FUNCTION_ITEM_BASE,
                paddingLeft: '16px',
                ...(isSelected ? FUNCTION_ITEM_SELECTED : {}),
              }
              return (
                <div
                  key={node.id}
                  ref={el => {
                    if (el) itemRefs.current.set(node.id, el)
                    else itemRefs.current.delete(node.id)
                  }}
                  style={itemStyle}
                  onClick={() => focusNode(node.id)}
                  onMouseEnter={e => {
                    if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = '#0f3460'
                  }}
                  onMouseLeave={e => {
                    if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = ''
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusNode(node.id) }
                  }}
                >
                  <span style={{ ...FUNCTION_NAME_STYLE, fontSize: 12 }}>{getDisplayName(node)}</span>
                  <span style={FILE_LOCATION_STYLE}>
                    {node.filePath.split('/').pop()}:{node.line}
                  </span>
                  <span style={{ fontSize: 10, color: '#666', marginLeft: 6 }}>({node.module})</span>
                  {entry && <span style={ENTRY_BADGE_STYLE}>entry</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

export default ModuleList
