import { LSPTransport } from './transport'
import type {
  InitializeParams,
  InitializeResult,
  CallHierarchyItem,
  CallHierarchyIncomingCall,
  CallHierarchyOutgoingCall,
  DocumentSymbolParams,
  Hover,
  HoverParams,
  CallHierarchyPrepareParams,
  CallHierarchyIncomingCallsParams,
  CallHierarchyOutgoingCallsParams,
  Position,
  LSPMessage,
} from './types'
import * as fs from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { execSync } from 'child_process'

function findRustAnalyzer(): string {
  // 1. Check RUST_ANALYZER_PATH env var
  if (process.env.RUST_ANALYZER_PATH) {
    return process.env.RUST_ANALYZER_PATH
  }
  // 2. Try which/where
  try {
    const which = process.platform === 'win32' ? 'where' : 'which'
    const result = execSync(`${which} rust-analyzer`, { encoding: 'utf-8' }).trim()
    if (result) return result
  } catch {
    // Fall through
  }
  // 3. Default
  return 'rust-analyzer'
}

export interface LSPClientOptions {
  rustAnalyzerPath?: string
  workspaceRoot: string
  timeout?: number
  maxRetries?: number
}

export class LSPClient {
  private transport: LSPTransport
  private workspaceRoot: string
  private initialized = false
  private retryCount = 0
  private maxRetries: number
  private lastError: Error | null = null
  private documentVersions: Map<string, number> = new Map()
  private onNotification: ((method: string, params?: unknown) => void) | null = null
  private healthCheckInterval: NodeJS.Timeout | null = null

  // Warm cache for call hierarchy results
  private callCache: Map<string, { incoming: CallHierarchyIncomingCall[]; outgoing: CallHierarchyOutgoingCall[] }> = new Map()

  constructor(options: LSPClientOptions) {
    this.workspaceRoot = options.workspaceRoot
    this.maxRetries = options.maxRetries ?? 3

    const rustAnalyzerPath = options.rustAnalyzerPath ?? findRustAnalyzer()
    console.log(`[LSP] Using rust-analyzer at: ${rustAnalyzerPath}`)

    this.transport = new LSPTransport(
      {
        command: rustAnalyzerPath,
        args: [],
        onData: (message: string) => {
          const msg = message as unknown as LSPMessage
          // Handle notifications from the server
          if (msg.method) {
            this.handleNotification(msg.method, msg.params)
          }
        },
        onError: (error: Error) => {
          console.error('[LSP] Transport error:', error.message)
          this.lastError = error
        },
        onExit: (code, signal) => {
          console.error(`[LSP] Process exited: code=${code}, signal=${signal}`)
          this.initialized = false
          this.stopHealthCheck()
          this.attemptReconnect()
        },
      },
      options.timeout ?? 30000
    )
  }

  private handleNotification(method: string, _params?: unknown): void {
    if (this.onNotification) {
      this.onNotification(method, _params)
    }
  }

  setNotificationHandler(handler: (method: string, params?: unknown) => void): void {
    this.onNotification = handler
  }

  private attemptReconnect(): void {
    if (this.retryCount >= this.maxRetries) {
      console.error(`[LSP] Max retries (${this.maxRetries}) reached. Giving up.`)
      return
    }

    this.retryCount++
    console.log(`[LSP] Reconnecting (attempt ${this.retryCount}/${this.maxRetries})...`)

    // Exponential backoff
    const delay = Math.min(1000 * Math.pow(2, this.retryCount - 1), 10000)
    setTimeout(() => {
      this.start().catch((err) => {
        console.error('[LSP] Reconnect failed:', err.message)
      })
    }, delay)
  }

  async start(): Promise<void> {
    this.transport.start()
    await this.initialize()
    this.startHealthCheck()
  }

  private async initialize(): Promise<void> {
    const params: InitializeParams = {
      processId: process.pid,
      clientInfo: {
        name: 'rust-call-graph-analyzer',
        version: '0.1.0',
      },
      capabilities: {
        textDocument: {
          callHierarchy: {
            dynamicRegistration: false,
          },
          documentSymbol: {
            dynamicRegistration: false,
            hierarchicalDocumentSymbolSupport: true,
            symbolKind: {
              valueSet: [
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
                16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
              ],
            },
          },
          hover: {
            dynamicRegistration: false,
            contentFormat: ['markdown', 'plaintext'],
          },
        },
      },
      initializationOptions: {
        linkedProjects: [
          path.join(this.workspaceRoot, 'Cargo.toml'),
        ],
      },
    }

    try {
      const result = await this.transport.sendRequest('initialize', params) as InitializeResult
      console.log('[LSP] Initialized:', result.serverInfo?.name ?? 'unknown server')

      // Send initialized notification
      this.transport.sendNotification('initialized', {})
      this.initialized = true
      this.retryCount = 0
      this.lastError = null
    } catch (err) {
      this.initialized = false
      throw new Error(`LSP initialization failed: ${err}`)
    }
  }

  private startHealthCheck(): void {
    this.stopHealthCheck()
    this.healthCheckInterval = setInterval(() => {
      if (!this.transport.isRunning) {
        console.warn('[LSP] Health check: transport not running')
        this.initialized = false
        this.attemptReconnect()
      }
    }, 30000)
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
  }

  async shutdown(): Promise<void> {
    this.stopHealthCheck()

    if (this.initialized) {
      try {
        await this.transport.sendRequest('shutdown', {})
      } catch {
        // Ignore shutdown errors
      }
      this.transport.sendNotification('exit', {})
    }

    this.transport.stop()
    this.initialized = false
    this.callCache.clear()
  }

  /**
   * Open a file in the LSP client so rust-analyzer can analyze it.
   * Files must be opened before querying symbols or call hierarchy.
   */
  async openDocument(filePath: string): Promise<void> {
    const uri = this.filePathToUri(filePath)
    const content = fs.readFileSync(filePath, 'utf-8')
    const version = (this.documentVersions.get(uri) ?? 0) + 1
    this.documentVersions.set(uri, version)

    this.transport.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId: 'rust',
        version,
        text: content,
      },
    })
  }

  /**
   * Close a document to free resources on the LSP server.
   */
  async closeDocument(filePath: string): Promise<void> {
    const uri = this.filePathToUri(filePath)
    this.transport.sendNotification('textDocument/didClose', {
      textDocument: { uri },
    })
    this.documentVersions.delete(uri)
  }

  /**
   * Get document symbols (functions, structs, enums, etc.) for a Rust file.
   */
  async getDocumentSymbols(filePath: string): Promise<any[]> {
    const uri = this.filePathToUri(filePath)
    const params: DocumentSymbolParams = {
      textDocument: { uri },
    }

    try {
      const result = await this.transport.sendRequest('textDocument/documentSymbol', params)
      return (result as any[]) ?? []
    } catch (err) {
      throw new Error(`Failed to get document symbols for ${filePath}: ${err}`)
    }
  }

  /**
   * Prepare call hierarchy for a function at the given position.
   * Uses selectionRange.start as required by rust-analyzer.
   */
  async prepareCallHierarchy(filePath: string, position: Position): Promise<CallHierarchyItem[]> {
    const uri = this.filePathToUri(filePath)
    const cacheKey = `${uri}:${position.line}:${position.character}`

    const params: CallHierarchyPrepareParams = {
      textDocument: { uri },
      position,
    }

    console.log(`[LSP] prepareCallHierarchy: ${uri} line:${position.line} char:${position.character}`)

    try {
      const result = await this.transport.sendRequest('textDocument/prepareCallHierarchy', params)
      const items = (result as CallHierarchyItem[]) ?? []
      console.log(`[LSP] prepareCallHierarchy response: ${items.length} items`)
      return items
    } catch (err) {
      console.error(`[LSP] prepareCallHierarchy FAILED: ${err}`)
      throw new Error(`Failed to prepare call hierarchy at ${filePath}:${position.line}: ${err}`)
    }
  }

  /**
   * Get incoming calls (who calls this function).
   */
  async getIncomingCalls(item: CallHierarchyItem): Promise<CallHierarchyIncomingCall[]> {
    const params: CallHierarchyIncomingCallsParams = { item }

    try {
      const result = await this.transport.sendRequest('callHierarchy/incomingCalls', params)
      return (result as CallHierarchyIncomingCall[]) ?? []
    } catch (err) {
      throw new Error(`Failed to get incoming calls for ${item.name}: ${err}`)
    }
  }

  /**
   * Get outgoing calls (who this function calls).
   */
  async getOutgoingCalls(item: CallHierarchyItem): Promise<CallHierarchyOutgoingCall[]> {
    const params: CallHierarchyOutgoingCallsParams = { item }

    try {
      const result = await this.transport.sendRequest('callHierarchy/outgoingCalls', params)
      return (result as CallHierarchyOutgoingCall[]) ?? []
    } catch (err) {
      throw new Error(`Failed to get outgoing calls for ${item.name}: ${err}`)
    }
  }

  /**
   * Get hover information (doc comments + type inference) for a position.
   * Returns markdown content from rust-analyzer.
   */
  async getHover(filePath: string, position: Position): Promise<Hover | null> {
    const uri = this.filePathToUri(filePath)
    const params: HoverParams = {
      textDocument: { uri },
      position,
    }

    console.log(`[LSP] getHover: ${uri} line:${position.line} char:${position.character}`)

    try {
      const result = await this.transport.sendRequest('textDocument/hover', params)
      if (!result) {
        console.log(`[LSP] getHover: no result for ${uri}`)
        return null
      }
      const hover = result as Hover
      console.log(`[LSP] getHover: received response for ${uri}`)
      return hover
    } catch (err) {
      console.error(`[LSP] getHover FAILED: ${err}`)
      return null
    }
  }

  /**
   * Get both incoming and outgoing calls for a function, with caching.
   */
  async getCallHierarchy(item: CallHierarchyItem): Promise<{
    incoming: CallHierarchyIncomingCall[]
    outgoing: CallHierarchyOutgoingCall[]
  }> {
    const cacheKey = `${item.uri}:${item.selectionRange.start.line}`

    // Check cache
    const cached = this.callCache.get(cacheKey)
    if (cached) {
      return cached
    }

    const incoming = await this.getIncomingCalls(item)
    const outgoing = await this.getOutgoingCalls(item)

    const result = { incoming, outgoing }
    this.callCache.set(cacheKey, result)

    // Limit cache size to 1000 entries
    if (this.callCache.size > 1000) {
      const firstKey = this.callCache.keys().next().value
      if (firstKey) {
        this.callCache.delete(firstKey)
      }
    }

    return result
  }

  /**
   * Clear the call hierarchy cache.
   */
  clearCache(): void {
    this.callCache.clear()
  }

  /**
   * Convert a file path to a file:// URI.
   */
  private filePathToUri(filePath: string): string {
    const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(this.workspaceRoot, filePath)
    return pathToFileURL(absolute).href
  }

  /**
   * Check if a URI belongs to the current workspace (user code).
   */
  isUserCode(uri: string): boolean {
    const workspaceUri = this.filePathToUri(this.workspaceRoot)
    return uri.startsWith(workspaceUri)
  }

  get isInitialized(): boolean {
    return this.initialized
  }

  get error(): Error | null {
    return this.lastError
  }
}
