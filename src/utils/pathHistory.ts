const STORAGE_KEY = 'recent-project-paths'
const MAX_ITEMS = 10

export function getPathHistory(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, MAX_ITEMS)
  } catch {
    return []
  }
}

export function addToPathHistory(path: string): void {
  const trimmed = path.trim()
  if (!trimmed) return

  try {
    const history = getPathHistory()
    // Remove existing entry (deduplicate)
    const deduped = history.filter(p => p !== trimmed)
    // Add to front (most recent)
    deduped.unshift(trimmed)
    // Cap at MAX_ITEMS (evict oldest from tail)
    const capped = deduped.slice(0, MAX_ITEMS)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(capped))
  } catch {
    // Silently fail — non-critical feature
  }
}

export function clearPathHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Silently fail
  }
}
