import type { FunctionNode, CallEdge } from '../types/graph'

/**
 * BFS shortest path between two function nodes in a directed graph.
 * Returns an array of node IDs representing the path, or empty array if no path exists.
 */
export function findShortestPath(
  startId: string,
  endId: string,
  edges: CallEdge[],
  nodes: FunctionNode[]
): string[] {
  if (startId === endId) return [startId]

  // Build adjacency list (directed: outgoing edges from each node)
  const adjacency = new Map<string, string[]>()
  for (const node of nodes) {
    adjacency.set(node.id, [])
  }
  for (const edge of edges) {
    const neighbors = adjacency.get(edge.source)
    if (neighbors) {
      neighbors.push(edge.target)
    }
  }

  // BFS
  const visited = new Set<string>([startId])
  const parent = new Map<string, string | null>([[startId, null]])
  const queue: string[] = [startId]

  while (queue.length > 0) {
    const current = queue.shift()!
    const neighbors = adjacency.get(current) ?? []

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor)
        parent.set(neighbor, current)
        queue.push(neighbor)

        if (neighbor === endId) {
          // Reconstruct path
          const path: string[] = []
          let node: string | null = endId
          while (node !== null) {
            path.unshift(node)
            node = parent.get(node) ?? null
          }
          return path
        }
      }
    }
  }

  return [] // No path
}

/**
 * Get all nodes along a path (for highlighting).
 */
export function getPathNodes(path: string[], nodes: FunctionNode[]): FunctionNode[] {
  const idSet = new Set(path)
  return nodes.filter(n => idSet.has(n.id))
}

/**
 * Get all edges along a path (for highlighting).
 */
export function getPathEdges(path: string[], edges: CallEdge[]): CallEdge[] {
  if (path.length < 2) return []

  const pathEdges: CallEdge[] = []
  for (let i = 0; i < path.length - 1; i++) {
    const source = path[i]
    const target = path[i + 1]
    const matchingEdge = edges.find(e => e.source === source && e.target === target)
    if (matchingEdge) {
      pathEdges.push(matchingEdge)
    }
  }
  return pathEdges
}

/**
 * Filter nodes by module.
 */
export function filterNodesByModule(
  nodes: FunctionNode[],
  modules: string[]
): FunctionNode[] {
  if (modules.length === 0) return nodes
  const moduleSet = new Set(modules)
  return nodes.filter(n => moduleSet.has(n.module))
}

/**
 * Filter nodes by search query.
 */
export function filterNodesByQuery(
  nodes: FunctionNode[],
  query: string
): FunctionNode[] {
  if (!query.trim()) return nodes
  const q = query.toLowerCase()
  return nodes.filter(n =>
    n.name.toLowerCase().includes(q) ||
    n.filePath.toLowerCase().includes(q)
  )
}

/**
 * Get unique modules from nodes.
 */
export function getModules(nodes: FunctionNode[]): string[] {
  return [...new Set(nodes.map(n => n.module))].sort()
}

/**
 * Find isolated nodes (no edges connected).
 */
export function getIsolatedNodes(nodes: FunctionNode[], edges: CallEdge[]): FunctionNode[] {
  const connectedIds = new Set<string>()
  for (const edge of edges) {
    connectedIds.add(edge.source)
    connectedIds.add(edge.target)
  }
  return nodes.filter(n => !connectedIds.has(n.id))
}

/**
 * Calculate max call depth using longest path in DAG-like graph.
 * Uses Bellman-Ford style approach for longest path (conservative estimate).
 */
export function estimateMaxDepth(nodes: FunctionNode[], edges: CallEdge[]): number {
  if (nodes.length === 0 || edges.length === 0) return 0

  // Build in-degree map
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const node of nodes) {
    inDegree.set(node.id, 0)
    adjacency.set(node.id, [])
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target)
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
  }

  // Topological sort with Kahn's algorithm
  const depth = new Map<string, number>()
  const queue: string[] = []

  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(nodeId)
      depth.set(nodeId, 0)
    }
  }

  let maxDepth = 0
  while (queue.length > 0) {
    const current = queue.shift()!
    const currentDepth = depth.get(current) ?? 0
    maxDepth = Math.max(maxDepth, currentDepth)

    for (const neighbor of adjacency.get(current) ?? []) {
      const newDepth = currentDepth + 1
      const existingDepth = depth.get(neighbor) ?? 0
      depth.set(neighbor, Math.max(existingDepth, newDepth))

      const newDegree = (inDegree.get(neighbor) ?? 1) - 1
      inDegree.set(neighbor, newDegree)
      if (newDegree === 0) {
        queue.push(neighbor)
      }
    }
  }

  return maxDepth
}
