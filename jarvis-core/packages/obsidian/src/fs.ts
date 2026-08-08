import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import type { VaultFs } from './vault'

// The only module here that touches the filesystem, isolated for the
// same reason as Graphify's walker: everything else stays testable
// without a temp directory.

const IGNORED = new Set(['.obsidian', '.git', '.trash', 'node_modules'])

/**
 * Vault backed by a directory on disk.
 *
 * Writes are atomic (temp file, then rename) because a note interrupted
 * mid-write is a note that looks empty next time Obsidian opens it —
 * and unlike Graphify's index, this content cannot be regenerated.
 */
export function createVaultFs(root: string): VaultFs {
  return {
    async list() {
      const found: string[] = []

      async function descend(directory: string): Promise<void> {
        let entries
        try {
          entries = await readdir(directory, { withFileTypes: true })
        } catch {
          return
        }
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (IGNORED.has(entry.name)) continue
            await descend(join(directory, entry.name))
            continue
          }
          if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
          found.push(relative(root, join(directory, entry.name)).split(sep).join('/'))
        }
      }

      await descend(root)
      return found.sort()
    },

    async read(path: string) {
      return readFile(join(root, path), 'utf8')
    },

    async write(path: string, contents: string) {
      const absolute = join(root, path)
      await mkdir(dirname(absolute), { recursive: true })
      const temporary = `${absolute}.tmp`
      await writeFile(temporary, contents, 'utf8')
      await rename(temporary, absolute)
    },

    async exists(path: string) {
      try {
        await stat(join(root, path))
        return true
      } catch {
        return false
      }
    },
  }
}

/** In-memory vault, for tests and for callers with no disk. */
export function createMemoryVaultFs(initial: Record<string, string> = {}): VaultFs & {
  files: Map<string, string>
} {
  const files = new Map(Object.entries(initial))
  return {
    files,
    async list() {
      return [...files.keys()].sort()
    },
    async read(path: string) {
      const contents = files.get(path)
      if (contents === undefined) throw new Error(`No such note: ${path}`)
      return contents
    },
    async write(path: string, contents: string) {
      files.set(path, contents)
    },
    async exists(path: string) {
      return files.has(path)
    },
  }
}
