import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './App.css'

// Override console methods to also send to main process log file
const api = (window as any).electronAPI
if (api?.logToFile) {
  const origLog = console.log
  const origError = console.error
  const origWarn = console.warn
  const origDebug = console.debug

  console.log = (...args: unknown[]) => {
    api.logToFile('LOG', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
    origLog.apply(console, args)
  }

  console.error = (...args: unknown[]) => {
    api.logToFile('ERROR', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
    origError.apply(console, args)
  }

  console.warn = (...args: unknown[]) => {
    api.logToFile('WARN', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
    origWarn.apply(console, args)
  }

  console.debug = (...args: unknown[]) => {
    api.logToFile('DEBUG', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '))
    origDebug.apply(console, args)
  }

  console.log('[renderer] Console forwarding to main process log file enabled')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
