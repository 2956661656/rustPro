import React, { useState, useEffect, useRef } from 'react'
import { useGraphStore } from '../store/useGraphStore'

// ─── Constants ──────────────────────────────────────────────────────

const DEBOUNCE_MS = 300

const SEARCH_INPUT_STYLE: React.CSSProperties = {
  background: '#0f3460',
  color: '#eaeaea',
  border: '1px solid #16213e',
  width: '100%',
  padding: '8px 12px',
  borderRadius: '4px',
  boxSizing: 'border-box',
  outline: 'none',
}

const CLEAR_BUTTON_STYLE: React.CSSProperties = {
  position: 'absolute',
  right: '8px',
  top: '50%',
  transform: 'translateY(-50%)',
  background: 'none',
  border: 'none',
  color: '#eaeaea',
  cursor: 'pointer',
  fontSize: '16px',
  lineHeight: 1,
  padding: '0 4px',
  opacity: 0.7,
}

const WRAPPER_STYLE: React.CSSProperties = {
  position: 'relative',
  width: '100%',
}

// ─── Component ──────────────────────────────────────────────────────

const SearchBar: React.FC = () => {
  const searchQuery = useGraphStore((s) => s.searchQuery)
  const setSearchQuery = useGraphStore((s) => s.setSearchQuery)

  const [localQuery, setLocalQuery] = useState(searchQuery)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  // Sync external changes (e.g. store reset) to local state
  useEffect(() => {
    setLocalQuery(searchQuery)
  }, [searchQuery])

  // Auto-focus the input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Debounced dispatch: flush localQuery to the store after DEBOUNCE_MS of inactivity
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    timerRef.current = setTimeout(() => {
      setSearchQuery(localQuery)
    }, DEBOUNCE_MS)
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [localQuery, setSearchQuery])

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    setLocalQuery(event.target.value)
  }

  const handleClear = (): void => {
    setLocalQuery('')
    setSearchQuery('')
  }

  const isActive = localQuery.length > 0

  return (
    <div style={WRAPPER_STYLE}>
      <input
        ref={inputRef}
        type="text"
        className="search-input"
        value={localQuery}
        onChange={handleInputChange}
        placeholder="Search functions..."
        style={SEARCH_INPUT_STYLE}
        onFocus={(e) => {
          e.currentTarget.style.outline = '2px solid #e94560'
        }}
        onBlur={(e) => {
          e.currentTarget.style.outline = 'none'
        }}
      />
      {isActive && (
        <button
          onClick={handleClear}
          style={CLEAR_BUTTON_STYLE}
          aria-label="Clear search"
          tabIndex={-1}
        >
          ×
        </button>
      )}
    </div>
  )
}

export default SearchBar
