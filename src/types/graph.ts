// Core data types for the call graph

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
