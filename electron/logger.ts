import fs from 'fs'
import path from 'path'

let logStream: fs.WriteStream | null = null
let isInitialized = false
let diagnosticLinesWritten = 0
const DIAGNOSTIC_CAP = 50

/**
 * Initialize file logging for the main process.
 * Creates a log file at logs/app-{timestamp}.log and intercepts console methods.
 */
export function initLogger(): void {
  if (isInitialized) return
  isInitialized = true
  diagnosticLinesWritten = 0

  // Ensure logs directory exists
  const logsDir = path.join(process.cwd(), 'logs')
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true })
  }

  const now = new Date()
  const timestamp = 
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_` +
    `${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`
  const logPath = path.join(logsDir, `app-${timestamp}.log`)

  logStream = fs.createWriteStream(logPath, { flags: 'a' })

  function write(level: string, args: unknown[]): void {
    const ts = new Date().toISOString()
    const message = args.map(a => 
      typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
    ).join(' ')

    // Filter LSP diagnostic spam: only log errors past the cap threshold
    if (message.includes('publishDiagnostics') && !/error/i.test(message)) {
      if (diagnosticLinesWritten >= DIAGNOSTIC_CAP) return // silently drop
      diagnosticLinesWritten++
      if (diagnosticLinesWritten === DIAGNOSTIC_CAP) {
        const line = `[${ts}] [${level}] ${message}\n`
        logStream?.write(line)
        const capLine = `[${ts}] [INFO] [logger] Diagnostic spam capped at ${DIAGNOSTIC_CAP} lines (suppressing further non-error diagnostics)\n`
        logStream?.write(capLine)
        return
      }
    }

    const line = `[${ts}] [${level}] ${message}\n`
    logStream?.write(line)
  }

  // Intercept console methods
  const origLog = console.log
  const origError = console.error
  const origWarn = console.warn
  const origDebug = console.debug

  console.log = (...args: unknown[]) => {
    write('LOG', args)
    origLog.apply(console, args)
  }

  console.error = (...args: unknown[]) => {
    write('ERROR', args)
    origError.apply(console, args)
  }

  console.warn = (...args: unknown[]) => {
    write('WARN', args)
    origWarn.apply(console, args)
  }

  console.debug = (...args: unknown[]) => {
    write('DEBUG', args)
    origDebug.apply(console, args)
  }

  // Capture uncaught exceptions and unhandled rejections
  process.on('uncaughtException', (err) => {
    write('FATAL', [`Uncaught Exception: ${err.message}`, err.stack ?? ''])
  })

  process.on('unhandledRejection', (reason) => {
    write('FATAL', [`Unhandled Rejection: ${reason}`])
  })

  // Also capture stdout/stderr from child processes (like rust-analyzer)
  // This is already done via transport.ts console.debug for stderr

  // Log startup
  write('INFO', [`Logger initialized at ${logPath}`])
  console.log(`[logger] Log file: ${logPath}`)
}

/**
 * Write a log entry from any process (e.g., renderer via IPC).
 */
export function writeLog(level: string, message: string): void {
  if (!logStream) return
  const ts = new Date().toISOString()
  const line = `[${ts}] [${level}] ${message}\n`
  logStream.write(line)
}

/**
 * Close the log stream. Call on app quit.
 */
export function closeLogger(): void {
  if (logStream) {
    logStream.end()
    logStream = null
  }
  isInitialized = false
}
