import * as fs from 'fs'
import * as path from 'path'
import { glob } from 'glob'

export interface ScanOptions {
  workspaceRoot: string
  excludeDirs?: string[]
}

export interface ScannedFile {
  filePath: string
  relativePath: string
}

/**
 * Scan a Rust project for .rs files, excluding common non-source directories.
 */
export class ProjectScanner {
  private workspaceRoot: string
  private excludeDirs: string[]

  constructor(options: ScanOptions) {
    this.workspaceRoot = options.workspaceRoot
    this.excludeDirs = options.excludeDirs ?? ['target', '.git', 'node_modules']
  }

  /**
   * Get all Rust source files in the project.
   */
  async scan(): Promise<ScannedFile[]> {
    const pattern = path.join(this.workspaceRoot, '**/*.rs')
    
    // Build ignore patterns
    const ignorePatterns = this.excludeDirs.map(dir => 
      path.join(this.workspaceRoot, dir, '**')
    )

    const files = await glob(pattern, {
      ignore: ignorePatterns,
      nodir: true,
      dot: false,
    })

    return files.map(filePath => ({
      filePath,
      relativePath: path.relative(this.workspaceRoot, filePath),
    }))
  }

  /**
   * Check if a file is a Rust source file within the workspace.
   */
  isRustFile(filePath: string): boolean {
    return filePath.endsWith('.rs') && filePath.startsWith(this.workspaceRoot)
  }

  /**
   * Check if a path should be excluded.
   */
  private isExcluded(filePath: string): boolean {
    const relPath = path.relative(this.workspaceRoot, filePath)
    return this.excludeDirs.some(dir => relPath.startsWith(dir + path.sep))
  }
}
