// Core data types for the call graph

export type TraitKind = 'none' | 'definition' | 'implementation'

export interface FunctionNode {
  id: string
  name: string
  filePath: string
  line: number
  character: number
  module: string
  isUserCode: boolean
  callCount: number
  fanIn: number
  fanOut: number
  detail?: string
  parameterTypes: string[]
  returnType: string | null
  endLine?: number
  endCharacter?: number
  traitKind: TraitKind
}

/**
 * Get the display name for a function node, appending trait markers.
 * - Trait definitions get " (trait)" suffix
 * - Trait implementations get " 🧬" suffix
 * - Regular functions return the name as-is
 */
export function getDisplayName(node: { name: string; traitKind: TraitKind }): string {
  if (node.traitKind === 'definition') return `${node.name} (trait)`
  if (node.traitKind === 'implementation') return `${node.name} 🧬`
  return node.name
}

export interface CallEdge {
  source: string // function id
  target: string // function id
  callCount: number
  callSites: Array<{ file: string; line: number }>
  isExternal: boolean
}

export interface CallGraphData {
  nodes: FunctionNode[]
  edges: CallEdge[]
  stats: {
    totalFunctions: number
    totalEdges: number
    isolatedFunctions: number
    maxCallDepth: number
    topCalled: Array<{ name: string; count: number }>
    topCallers: Array<{ name: string; count: number }>
  }
}
