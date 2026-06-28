import { useState, useEffect, useCallback } from 'react'
import type { FileTreeNode } from '../types/directory'

interface UseDirectoryTreeResult {
  data: FileTreeNode | null
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useDirectoryTree(projectPath: string | null): UseDirectoryTreeResult {
  const [data, setData] = useState<FileTreeNode | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fetchKey, setFetchKey] = useState(0)

  const refetch = useCallback(() => {
    setFetchKey(k => k + 1)
  }, [])

  useEffect(() => {
    if (!projectPath) {
      setData(null)
      setIsLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)

    window.electronAPI.getDirectoryTree(projectPath)
      .then((tree: FileTreeNode) => {
        if (!cancelled) {
          setData(tree)
          setIsLoading(false)
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message || 'Failed to load directory tree')
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [projectPath, fetchKey])

  return { data, isLoading, error, refetch }
}
