import { spawn, ChildProcess } from 'child_process'
import type { LSPMessage } from './types'

export interface TransportOptions {
  command: string
  args?: string[]
  onData: (message: string) => void
  onError: (error: Error) => void
  onExit: (code: number | null, signal: string | null) => void
}

export class LSPTransport {
  private process: ChildProcess | null = null
  private buffer = ''
  private contentLength = -1
  private idCounter = 0
  private pendingRequests: Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }> = new Map()
  private requestTimeoutMs: number

  constructor(
    private options: TransportOptions,
    requestTimeoutMs = 30000
  ) {
    this.requestTimeoutMs = requestTimeoutMs
  }

  get isRunning(): boolean {
    return this.process !== null && !this.process.killed
  }

  start(): void {
    if (this.process) {
      throw new Error('Transport already started')
    }

    this.process = spawn(this.options.command, this.options.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, RUST_ANALYZER_EDITOR: 'rust-call-graph-analyzer' },
    })

    const stdout = this.process.stdout
    if (!stdout) {
      throw new Error('Failed to get stdout from LSP process')
    }

    // Read LSP messages from stdout using the LSP protocol (Content-Length headers + JSON body).
    // We process raw data chunks rather than using readline, because LSP uses \r\n headers
    // followed by JSON bodies that may span multiple lines.
    stdout.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString()
      this.tryParseMessage()
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      // rust-analyzer logs diagnostics to stderr - capture for debugging but don't parse as LSP
      const msg = data.toString().trim()
      if (msg) {
        console.debug('[rust-analyzer stderr]', msg)
      }
    })

    this.process.on('error', (err: Error) => {
      this.options.onError(err)
    })

    this.process.on('exit', (code, signal) => {
      this.options.onExit(code, signal)
      // Reject all pending requests so callers don't hang indefinitely
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timer)
        pending.reject(new Error(`LSP process exited (code=${code}, signal=${signal}) before completing request ${id}`))
      }
      this.pendingRequests.clear()
      this.process = null
    })
  }

  private tryParseMessage(): void {
    while (this.buffer.length > 0) {
      if (this.contentLength < 0) {
        const headerEnd = this.buffer.indexOf('\r\n\r\n')
        if (headerEnd === -1) return // Wait for more data

        const header = this.buffer.substring(0, headerEnd)
        const contentLengthMatch = header.match(/Content-Length: (\d+)/i)
        if (!contentLengthMatch) {
          throw new Error('Missing Content-Length header')
        }
        this.contentLength = parseInt(contentLengthMatch[1], 10)
        this.buffer = this.buffer.substring(headerEnd + 4) // Skip \r\n\r\n
      }

      if (this.buffer.length >= this.contentLength) {
        const content = this.buffer.substring(0, this.contentLength)
        this.buffer = this.buffer.substring(this.contentLength)
        this.contentLength = -1

        try {
          const message = JSON.parse(content)
          this.dispatchMessage(message)
        } catch (err) {
          this.options.onError(new Error(`Failed to parse LSP message: ${err}`))
        }
      } else {
        break // Wait for more data
      }
    }
  }

  private dispatchMessage(message: any): void {
    // Check if this is a response to a request
    if (message.id !== undefined && message.id !== null) {
      const pending = this.pendingRequests.get(message.id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingRequests.delete(message.id)
        if (message.error) {
          pending.reject(new Error(`LSP error ${message.error.code}: ${message.error.message}`))
        } else {
          pending.resolve(message.result)
        }
        return
      }
    }

    // Otherwise it's a notification
    this.options.onData(message)
  }

  async sendRequest(method: string, params?: unknown): Promise<unknown> {
    if (!this.process || !this.process.stdin) {
      throw new Error('LSP transport not connected')
    }

    const id = ++this.idCounter
    const message: LSPMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    const body = JSON.stringify(message)
    const header = `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n`

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`LSP request "${method}" (id=${id}) timed out after ${this.requestTimeoutMs}ms`))
      }, this.requestTimeoutMs)

      this.pendingRequests.set(id, { resolve, reject, timer })

      this.process!.stdin!.write(header + body, (err) => {
        if (err) {
          clearTimeout(timer)
          this.pendingRequests.delete(id)
          reject(new Error(`Failed to write to LSP stdin: ${err.message}`))
        }
      })
    })
  }

  sendNotification(method: string, params?: unknown): void {
    if (!this.process || !this.process.stdin) {
      throw new Error('LSP transport not connected')
    }

    const message: LSPMessage = {
      jsonrpc: '2.0',
      method,
      params,
    }

    const body = JSON.stringify(message)
    const header = `Content-Length: ${Buffer.byteLength(body, 'utf-8')}\r\n\r\n`

    this.process.stdin.write(header + body)
  }

  stop(): void {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
  }
}
