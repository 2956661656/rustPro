import { LSPClient } from './lsp/client'
import { SymbolKind } from './lsp/types'
import type { CallHierarchyItem, CallHierarchyIncomingCall, CallHierarchyOutgoingCall, Position } from './lsp/types'
import { ProjectScanner, ScannedFile } from './scanner'
import type { FunctionNode, CallEdge, CallGraphData, TraitKind } from '../src/types/graph'
import * as path from 'path'
import { fileURLToPath } from 'url'

/**
 * Parse rust-analyzer's DocumentSymbol detail string into structured type info.
 * Example inputs:
 *   - "fn main()" → { parameterTypes: [], returnType: null }
 *   - "fn foo(x: i32) -> String" → { parameterTypes: ["x: i32"], returnType: "String" }
 *   - "fn bar(a: &str, b: u64)" → { parameterTypes: ["a: &str", "b: u64"], returnType: null }
 */
function parseFunctionDetail(detail: string): { parameterTypes: string[]; returnType: string | null } {
  if (!detail) return { parameterTypes: [], returnType: null }

  const match = detail.match(/^fn\s+\w+\s*\(([^)]*)\)\s*(?:->\s*(.+))?/)
  if (!match) return { parameterTypes: [], returnType: null }

  const paramsStr = match[1].trim()
  const returnType = match[2]?.trim() ?? null

  const parameterTypes = paramsStr
    ? paramsStr.split(',').map(p => p.trim()).filter(p => p.length > 0)
    : []

  return { parameterTypes, returnType }
}

export interface NodeDiscoveryResult {
  nodes: FunctionNode[]
  filesProcessed: number
  totalFiles: number
}

export interface EdgeDiscoveryResult {
  edges: CallEdge[]
  newNodes: FunctionNode[]
  functionsProcessed: number
  totalFunctions: number
}

/**
 * Builds and manages the call graph from LSP data.
 * Phase 3: Nodes first (lightweight), edges loaded on demand (Phase 6).
 */
export class GraphBuilder {
  private client: LSPClient
  private scanner: ProjectScanner
  private workspaceRoot: string

  // Trait implementation tracking: traitDefNodeId → implNodeId[]
  private traitDefToImplsMap: Map<string, string[]> = new Map()

  constructor(client: LSPClient, workspaceRoot: string) {
    this.client = client
    this.scanner = new ProjectScanner({ workspaceRoot })
    this.workspaceRoot = workspaceRoot
  }

  /**
   * Phase 3.3: Discover all function nodes in the project.
   * Uses documentSymbol for each .rs file to find functions.
   * This is a lightweight operation - no call edges yet.
   */
  async discoverNodes(
    onProgress?: (progress: number, message: string) => void
  ): Promise<NodeDiscoveryResult> {
    const startTime = Date.now()
    const files = await this.scanner.scan()
    const nodes: FunctionNode[] = []
    const fileCount = files.length

    for (let i = 0; i < fileCount; i++) {
      const file = files[i]
      
      // Report progress
      if (onProgress) {
        const pct = Math.round(((i + 1) / fileCount) * 100)
        onProgress(pct, `Scanning ${file.relativePath}`)
      }

      // Open the file in LSP
      try {
        await this.client.openDocument(file.filePath)
      } catch (err) {
        console.warn(`[GraphBuilder] Failed to open ${file.relativePath}: ${err}`)
        continue
      }

      // Get document symbols
      let symbols: any[]
      try {
        symbols = await this.client.getDocumentSymbols(file.filePath)
      } catch (err) {
        console.warn(`[GraphBuilder] Failed to get symbols for ${file.relativePath}: ${err}`)
        await this.client.closeDocument(file.filePath)
        continue
      }

      // Extract function nodes from symbols
      const fileNodes = this.extractNodesFromSymbols(symbols, file)
      nodes.push(...fileNodes)

      // Close the document (we'll reopen when needed for edges)
      try {
        await this.client.closeDocument(file.filePath)
      } catch {
        // Ignore close errors
      }
    }

    const duration = Date.now() - startTime
    console.log(`[GraphBuilder] discoverNodes complete: ${nodes.length} nodes, ${fileCount} files, ${duration}ms`)

    // Build trait implementation mappings from discovered nodes
    this.buildTraitMappings(nodes)

    return {
      nodes,
      filesProcessed: fileCount,
      totalFiles: fileCount,
    }
  }

  /**
   * Recursively extract function nodes from document symbols.
   * DocumentSymbol in LSP can have nested children (e.g., impl blocks with methods).
   */
  private extractNodesFromSymbols(
    symbols: any[],
    file: ScannedFile,
    parentTraitKind?: TraitKind,
    parentTraitName?: string,
  ): FunctionNode[] {
    const nodes: FunctionNode[] = []

    for (const symbol of symbols) {
      console.log(`[GraphBuilder] Symbol: kind=${symbol.kind} (${SymbolKind[symbol.kind] ?? 'unknown'}) name="${symbol.name}" detail="${symbol.detail ?? ''}" children=${Array.isArray(symbol.children) ? symbol.children.length : 0}`)

      // Only include functions and methods
      if (this.isFunctionOrMethod(symbol.kind)) {
        const moduleName = this.inferModuleName(file)
        const typeInfo = parseFunctionDetail(symbol.detail ?? '')
        const node: FunctionNode = {
          id: `${file.filePath}:${symbol.selectionRange.start.line}`,
          name: symbol.name,
          filePath: file.filePath,
          line: symbol.selectionRange.start.line,
          character: symbol.selectionRange.start.character,
          module: moduleName,
          isUserCode: true,
          callCount: 0,
          fanIn: 0,
          fanOut: 0,
          detail: symbol.detail,
          parameterTypes: typeInfo.parameterTypes,
          returnType: typeInfo.returnType,
          endLine: symbol.range?.end?.line,
          endCharacter: symbol.range?.end?.character,
          traitKind: parentTraitKind ?? 'none',
          traitName: parentTraitName,
        }
        nodes.push(node)
        if (parentTraitKind) {
          console.log(`[GraphBuilder] Node "${node.name}" (id=${node.id}) traitKind=${node.traitKind} traitName=${node.traitName}`)
        }
      }

      // Recurse into children (e.g., impl blocks, nested modules)
      if (Array.isArray(symbol.children)) {
        // Determine trait context for children of this symbol
        let childCtx: TraitKind = parentTraitKind ?? 'none'
        let childTraitName: string | undefined = parentTraitName

        // parent is a trait definition (Interface = 11)
        if (symbol.kind === SymbolKind.Interface) {
          console.log(`[GraphBuilder] Trait def parent: "${symbol.name}" — children will get traitKind='definition'`)
          childCtx = 'definition'
          childTraitName = symbol.name
        }
        // parent is a trait impl (Class/Object, name contains "for" as a word)
        else if ((symbol.kind === SymbolKind.Class || symbol.kind === SymbolKind.Object) && typeof symbol.name === 'string' && /\bfor\b/.test(symbol.name)) {
          childCtx = 'implementation'
          const match = symbol.name.match(/^impl\s+(\w+)\s+for/)
          childTraitName = match ? match[1] : undefined
          console.log(`[GraphBuilder] Trait impl parent: "${symbol.name}" — trait="${childTraitName}" children will get traitKind='implementation'`)
        }

        nodes.push(...this.extractNodesFromSymbols(symbol.children, file, childCtx, childTraitName))
      }
    }

    return nodes
  }

  /**
   * Build mappings from trait definition nodes to their implementation nodes.
   * Direction: def → impl[] (one trait definition can have many implementations).
   * Only works within the scanned project (user code traits only).
   */
  private buildTraitMappings(nodes: FunctionNode[]): void {
    // Group definition nodes by (traitName, methodName)
    const defMap = new Map<string, string>()  // key: "traitName::methodName" → nodeId
    let defCount = 0
    let implCount = 0
    let matchedCount = 0
    let unmatchedCount = 0

    for (const node of nodes) {
      if (node.traitKind === 'definition' && node.traitName) {
        const key = `${node.traitName}::${node.name}`
        // Sanity check: there should only be one definition per trait method
        if (defMap.has(key)) {
          console.warn(`[GraphBuilder] Duplicate trait definition key "${key}": existing=${defMap.get(key)}, new=${node.id}`)
        }
        defMap.set(key, node.id)
        defCount++
        console.log(`[GraphBuilder] Trait def found: ${node.name} (trait="${node.traitName}", key="${key}", id=${node.id})`)
      }
    }

    // Match implementation nodes to definitions
    this.traitDefToImplsMap.clear()
    for (const node of nodes) {
      if (node.traitKind === 'implementation' && node.traitName) {
        implCount++
        const key = `${node.traitName}::${node.name}`
        const defNodeId = defMap.get(key)
        if (defNodeId) {
          const impls = this.traitDefToImplsMap.get(defNodeId)
          if (impls) {
            impls.push(node.id)
          } else {
            this.traitDefToImplsMap.set(defNodeId, [node.id])
          }
          matchedCount++
          console.log(`[GraphBuilder] Trait mapping MATCH: def=${defNodeId} (${node.traitName}::${node.name}) ⇢ impl=${node.id} (${node.name})`)
        } else {
          unmatchedCount++
          console.log(`[GraphBuilder] Trait mapping NO MATCH: impl=${node.id} (${node.name}) — trait "${node.traitName}" definition not found in project`)
        }
      }
    }

    // Summary
    for (const [defId, implIds] of this.traitDefToImplsMap) {
      console.log(`[GraphBuilder] Trait summary: def=${defId} → ${implIds.length} impl(s): [${implIds.join(', ')}]`)
    }
    console.log(`[GraphBuilder] buildTraitMappings complete: ${defCount} defs, ${implCount} impls, ${matchedCount} matched, ${unmatchedCount} unmatched, ${this.traitDefToImplsMap.size} def→impl entries`)
  }

  /**
   * Check if a symbol kind is a function or method.
   */
  private isFunctionOrMethod(kind: number): boolean {
    return kind === SymbolKind.Function || kind === SymbolKind.Method
  }

  /**
   * Infer the module name from file path.
   */
  private inferModuleName(file: ScannedFile): string {
    const dir = path.dirname(file.relativePath)
    if (dir === '.') return file.relativePath.replace('.rs', '')
    
    // Use the top-level directory as module name
    const topDir = dir.split(path.sep)[0]
    return topDir
  }

  /**
   * (Phase 6) Get edges for a specific function node.
   * Opens the file, prepares call hierarchy, gets incoming/outgoing calls.
   */
  async getEdgesForNode(node: FunctionNode): Promise<{
    incoming: CallEdge[]
    outgoing: CallEdge[]
    newNodes: FunctionNode[]
  }> {
    const startTime = Date.now()
    // Open the file
    await this.client.openDocument(node.filePath)
    console.log(`[GraphBuilder] getEdgesForNode entered: ${node.name} at ${node.filePath}:${node.line}:${node.character}`)

    try {
      // Prepare call hierarchy at the function's position
      const position: Position = {
        line: node.line,
        character: node.character,
      }

      const MAX_RETRIES = 3
      const RETRY_DELAY_MS = 600

      let items: CallHierarchyItem[] = []
      let lastError: unknown = null

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          items = await this.client.prepareCallHierarchy(node.filePath, position)
          console.log(`[GraphBuilder] prepareCallHierarchy returned ${items.length} items (attempt ${attempt}/${MAX_RETRIES})`)
          if (items.length > 0) {
            console.log(`[GraphBuilder] First item: name="${items[0].name}" uri="${items[0].uri}"`)
            break // success - exit retry loop
          }
          // items.length === 0: server might not be ready, retry
          if (attempt < MAX_RETRIES) {
            console.log(`[GraphBuilder] prepareCallHierarchy returned 0 items, retrying in ${RETRY_DELAY_MS}ms...`)
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
          }
        } catch (err) {
          lastError = err
          const errStr = String(err)
          if (errStr.includes('content modified') && attempt < MAX_RETRIES) {
            console.log(`[GraphBuilder] prepareCallHierarchy content modified (attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY_MS}ms...`)
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
          } else {
            console.error(`[GraphBuilder] prepareCallHierarchy FAILED after ${attempt} attempts: ${err}`)
            return { incoming: [], outgoing: [], newNodes: [] }
          }
        }
      }

      if (items.length === 0) {
        console.warn(`[GraphBuilder] prepareCallHierarchy returned 0 items after ${MAX_RETRIES} attempts`)
        return { incoming: [], outgoing: [], newNodes: [] }
      }

      const item = items[0]

      // Retry loop for getCallHierarchy (getIncomingCalls + getOutgoingCalls)
      // These can also get "content modified" errors from rust-analyzer
      let hierarchy: { incoming: CallHierarchyIncomingCall[]; outgoing: CallHierarchyOutgoingCall[] } | null = null
      let hierarchySuccess = false

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          hierarchy = await this.client.getCallHierarchy(item)
          console.log(`[GraphBuilder] getCallHierarchy returned ${hierarchy.incoming.length} incoming, ${hierarchy.outgoing.length} outgoing (attempt ${attempt}/${MAX_RETRIES})`)
          hierarchySuccess = true
          break
        } catch (err) {
          const errStr = String(err)
          if (errStr.includes('content modified') && attempt < MAX_RETRIES) {
            console.log(`[GraphBuilder] getCallHierarchy content modified (attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY_MS}ms...`)
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
          } else {
            console.error(`[GraphBuilder] getCallHierarchy FAILED after ${attempt} attempts: ${err}`)
            return { incoming: [], outgoing: [], newNodes: [] }
          }
        }
      }

      if (!hierarchySuccess || !hierarchy) {
        console.warn(`[GraphBuilder] getCallHierarchy failed after ${MAX_RETRIES} attempts`)
        return { incoming: [], outgoing: [], newNodes: [] }
      }

      const incoming: CallEdge[] = hierarchy.incoming
        .map(call => ({
          source: this.nodeIdFromCallItem(call.from),
          target: node.id,
          callCount: call.fromRanges.length,
          callSites: call.fromRanges.map(r => ({
            file: call.from.uri,
            line: r.start.line,
          })),
          isExternal: !this.client.isUserCode(call.from.uri),
        }))

      const outgoing: CallEdge[] = hierarchy.outgoing
        .map(call => ({
          source: node.id,
          target: this.nodeIdFromCallItem(call.to),
          callCount: call.fromRanges.length,
          callSites: call.fromRanges.map(r => ({
            file: call.to.uri,
            line: r.start.line,
          })),
          isExternal: !this.client.isUserCode(call.to.uri),
        }))

      // Collect new nodes discovered via call hierarchy (may not exist in scanned nodes)
      const newNodeMap = new Map<string, FunctionNode>()
      for (const call of hierarchy.incoming) {
        const id = this.nodeIdFromCallItem(call.from)
        if (id !== node.id && !newNodeMap.has(id)) {
          newNodeMap.set(id, this.nodeFromCallItem(call.from))
        }
      }
      for (const call of hierarchy.outgoing) {
        const id = this.nodeIdFromCallItem(call.to)
        if (id !== node.id && !newNodeMap.has(id)) {
          newNodeMap.set(id, this.nodeFromCallItem(call.to))
        }
      }
      const newNodes = [...newNodeMap.values()]
      if (newNodes.length > 0) {
        console.log(`[GraphBuilder] Discovered ${newNodes.length} new nodes via call hierarchy`)
      }

      // ── Add trait implementation edges if applicable ──
      // Direction: always FROM trait definition TO implementation
      //
      // Case A: focus node is a trait DEFINITION → add OUTGOING edges to all its implementations
      if (this.traitDefToImplsMap.has(node.id)) {
        const implIds = this.traitDefToImplsMap.get(node.id)!
        console.log(`[GraphBuilder] Trait def focus: "${node.name}" (id=${node.id}) has ${implIds.length} impl(s), adding outgoing trait edge(s)`)
        for (const implId of implIds) {
          console.log(`[GraphBuilder] Trait edge (outgoing): def=${node.id} → impl=${implId}`)
          outgoing.push({
            source: node.id,
            target: implId,
            callCount: 0,
            callSites: [],
            isExternal: false,
            edgeKind: 'trait_impl',
          })
        }
      }
      // Case B: focus node is a trait IMPLEMENTATION → add INCOMING edge from its trait definition
      else {
        for (const [defId, implIds] of this.traitDefToImplsMap) {
          if (implIds.includes(node.id)) {
            console.log(`[GraphBuilder] Trait impl focus: "${node.name}" (id=${node.id}) belongs to def=${defId}, adding incoming trait edge`)
            incoming.push({
              source: defId,
              target: node.id,
              callCount: 0,
              callSites: [],
              isExternal: false,
              edgeKind: 'trait_impl',
            })
            break
          }
        }
      }

      // Count trait edges in the totals
      const traitIncoming = incoming.filter(e => e.edgeKind === 'trait_impl').length
      const traitOutgoing = outgoing.filter(e => e.edgeKind === 'trait_impl').length
      const callIncoming = incoming.length - traitIncoming
      const callOutgoing = outgoing.length - traitOutgoing
      console.log(`[GraphBuilder] getEdgesForNode done: ${node.name} → ${callIncoming} call-in + ${traitIncoming} trait-in / ${callOutgoing} call-out + ${traitOutgoing} trait-out (${newNodes.length} new), ${Date.now() - startTime}ms`)
      return { incoming, outgoing, newNodes }
    } finally {
      // Close the file
      try {
        await this.client.closeDocument(node.filePath)
      } catch {
        // Ignore close errors
      }
    }
  }

  /**
   * Get all edges for a set of function nodes (bulk operation for Phase 6).
   */
  async getEdgesForNodes(
    nodes: FunctionNode[],
    onProgress?: (progress: number, message: string) => void
  ): Promise<EdgeDiscoveryResult & { newNodes: FunctionNode[] }> {
    const startTime = Date.now()
    const edges: CallEdge[] = []
    const newNodes: FunctionNode[] = []
    const newNodeMap = new Map<string, FunctionNode>()
    const total = nodes.length
    let successCount = 0

    for (let i = 0; i < total; i++) {
      if (onProgress) {
        const pct = Math.round(((i + 1) / total) * 100)
        onProgress(pct, `Loading edges for ${nodes[i].name}`)
      }

      try {
        const result = await this.getEdgesForNode(nodes[i])
        successCount++
        edges.push(...result.incoming, ...result.outgoing)

        // Collect new nodes
        for (const n of result.newNodes) {
          if (!newNodeMap.has(n.id)) {
            newNodeMap.set(n.id, n)
          }
        }

        // Update fan-in/fan-out
        nodes[i].fanIn += result.incoming.length
        nodes[i].fanOut += result.outgoing.length
      } catch (err) {
        console.warn(`[GraphBuilder] Failed to get edges for ${nodes[i].name}: ${err}`)
      }
    }

    for (const n of newNodeMap.values()) newNodes.push(n)

    const duration = Date.now() - startTime
    console.log(`[GraphBuilder] getEdgesForNodes batch complete: ${edges.length} edges, ${total} functions, ${successCount} succeeded, ${total - successCount} failed, ${duration}ms`)

    return {
      edges,
      newNodes,
      functionsProcessed: total,
      totalFunctions: total,
    }
  }

  /**
   * Build the complete graph (nodes + all edges).
   */
  async buildCompleteGraph(
    onProgress?: (progress: number, message: string) => void
  ): Promise<CallGraphData> {
    const nodeResult = await this.discoverNodes((pct, msg) => {
      if (onProgress) onProgress(Math.round(pct / 2), msg) // First half of progress
    })

    const edgeResult = await this.getEdgesForNodes(nodeResult.nodes, (pct, msg) => {
      if (onProgress) onProgress(50 + Math.round(pct / 2), msg) // Second half
    })

    // Merge newly discovered nodes from call hierarchy into the final node list
    const allNodes = [...nodeResult.nodes, ...edgeResult.newNodes]
    const nodeMap = new Map<string, FunctionNode>()
    for (const n of allNodes) nodeMap.set(n.id, n)
    const finalNodes = [...nodeMap.values()]

    // Build stats
    const stats = this.computeStats(finalNodes, edgeResult.edges)

    return {
      nodes: finalNodes,
      edges: edgeResult.edges,
      stats,
    }
  }

  /**
   * Compute aggregate statistics for the call graph.
   */
  private computeStats(nodes: FunctionNode[], edges: CallEdge[]): CallGraphData['stats'] {
    const callCounts = new Map<string, number>()
    const callerCounts = new Map<string, number>()

    for (const edge of edges) {
      // Count incoming calls (who is called)
      callCounts.set(edge.target, (callCounts.get(edge.target) ?? 0) + edge.callCount)
      
      // Count outgoing calls (who calls)
      callerCounts.set(edge.source, (callerCounts.get(edge.source) ?? 0) + edge.callCount)
    }

    // Calculate fan-in and fan-out for all nodes
    for (const node of nodes) {
      node.fanIn = callCounts.get(node.id) ?? 0
      node.fanOut = callerCounts.get(node.id) ?? 0
    }

    // Isolated functions = nodes with no edges
    const nodesWithEdges = new Set<string>()
    for (const edge of edges) {
      nodesWithEdges.add(edge.source)
      nodesWithEdges.add(edge.target)
    }
    const isolatedFunctions = nodes.filter(n => !nodesWithEdges.has(n.id)).length

    // Top called functions
    const topCalled = [...callCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, count]) => {
        const node = nodes.find(n => n.id === id)
        return { name: node?.name ?? id, count }
      })

    // Top callers
    const topCallers = [...callerCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, count]) => {
        const node = nodes.find(n => n.id === id)
        return { name: node?.name ?? id, count }
      })

    return {
      totalFunctions: nodes.length,
      totalEdges: edges.length,
      isolatedFunctions,
      maxCallDepth: 0, // Computed during path tracing in Phase 6
      topCalled,
      topCallers,
    }
  }

  /**
   * Create a node ID from a CallHierarchyItem.
   */
  private nodeIdFromCallItem(item: CallHierarchyItem): string {
    return `${fileURLToPath(item.uri)}:${item.selectionRange.start.line}`
  }

  /**
   * Create a FunctionNode from a CallHierarchyItem (for external functions).
   */
  nodeFromCallItem(item: CallHierarchyItem): FunctionNode {
    const typeInfo = parseFunctionDetail(item.detail ?? '')
    return {
      id: this.nodeIdFromCallItem(item),
      name: item.name,
      filePath: fileURLToPath(item.uri),
      line: item.selectionRange.start.line,
      character: item.selectionRange.start.character,
      module: item.detail ?? 'external',
      isUserCode: this.client.isUserCode(item.uri),
      callCount: 0,
      fanIn: 0,
      fanOut: 0,
      detail: item.detail,
      parameterTypes: typeInfo.parameterTypes,
      returnType: typeInfo.returnType,
      endLine: item.range?.end?.line,
      endCharacter: item.range?.end?.character,
      traitKind: 'none' as TraitKind,
      traitName: undefined,
    }
  }
}
