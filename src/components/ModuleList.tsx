import React, { useState, useMemo, useCallback } from 'react'
import { useGraphStore } from '../store/useGraphStore'
import type { FunctionNode } from '../types/graph'

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
    // Use the first node's original module name as display name
    const displayModule = groupNodes[0].module
    // Sort functions within group alphabetically by name
    const sorted = [...groupNodes].sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    )
    groups.push({ module: displayModule, nodes: sorted })
  }

  // Sort groups alphabetically by module name
  groups.sort((a, b) =>
    a.module.toLowerCase().localeCompare(b.module.toLowerCase())
  )

  return groups
}

// ─── Component ──────────────────────────────────────────────────────

const ModuleList: React.FC = () => {
  const nodes = useGraphStore(s => s.nodes)
  const searchQuery = useGraphStore(s => s.searchQuery)
  const selectedNodeId = useGraphStore(s => s.selectedNodeId)
  const focusNode = useGraphStore(s => s.focusNode)

  const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set())

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

  // ── Derived state: group, filter, sort ──────────────────────────
  const moduleGroups = useMemo(() => {
    if (nodes.length === 0) return [] as ModuleGroup[]

    const grouped = groupNodesByModule(nodes)

    const trimmed = searchQuery.trim()

    // No active search — return all groups as-is
    if (!trimmed) return grouped

    // Filter each group by search query
    const filtered: ModuleGroup[] = []
    for (const group of grouped) {
      const matchingNodes = group.nodes.filter(n => matchesQuery(n, trimmed))
      if (matchingNodes.length > 0) {
        filtered.push({ module: group.module, nodes: matchingNodes })
      }
    }

    return filtered
  }, [nodes, searchQuery])

  // ── Early exit: empty state ─────────────────────────────────────
  if (nodes.length === 0) {
    return (
      <div style={EMPTY_STATE_STYLE}>
        No functions discovered
      </div>
    )
  }

  // ── Render ──────────────────────────────────────────────────────
  return (
    <>
      <style>{SCROLLBAR_STYLES}</style>
      <div className="module-list-container" style={CONTAINER_STYLE}>
        {moduleGroups.map(group => {
          const isCollapsed = collapsedModules.has(group.module)

          return (
            <div key={group.module}>
              {/* Module header */}
              <div
                style={MODULE_HEADER_STYLE}
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
                          style={itemStyle}
                          onClick={() => focusNode(node.id)}
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
                            {node.name}
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
      </div>
    </>
  )
}

export default ModuleList
