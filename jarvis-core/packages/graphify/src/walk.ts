import { readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { ObservedFile, StateStore } from './state'

// ---------------------------------------------------------------------
// The only module in this package that touches the filesystem.
//
// Isolated deliberately: everything else is pure, so the graph logic is
// testable without a temp directory and the fs concerns are auditable in
// one place.
// ---------------------------------------------------------------------

/**
 * Directories never descended into.
 *
 * node_modules is the one that matters — walking it turns a 500-file
 * repository into a 90,000-file one, and the result is other people's
 * code, which is not what a code memory of THIS system is for.
 */
export const DEFAULT_IGNORED_DIRECTORIES: readonly string[] = [
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.vercel',
  '.claude',
]

export const DEFAULT_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]

export interface WalkOptions {
  extensions?: readonly string[]
  ignoredDirectories?: readonly string[]
  /**
   * Files larger than this are skipped entirely. A generated bundle or
   * a vendored blob costs a great deal to index and teaches nothing —
   * and one 40 MB file can exhaust memory mid-run.
   */
  maxFileBytes?: number
}

export const DEFAULT_MAX_FILE_BYTES = 512 * 1024

/** Reads every indexable file under `root`, with POSIX-relative paths. */
export async function walkRepository(
  root: string,
  options: WalkOptions = {}
): Promise<ObservedFile[]> {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS
  const ignored = new Set(options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES)
  const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES

  const found: ObservedFile[] = []

  async function descend(directory: string): Promise<void> {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      // An unreadable directory skips rather than aborts. A permissions
      // quirk in one folder must not cost the whole index.
      return
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (ignored.has(entry.name)) continue
        await descend(join(directory, entry.name))
        continue
      }
      if (!entry.isFile()) continue
      if (!extensions.some((extension) => entry.name.endsWith(extension))) continue

      const absolute = join(directory, entry.name)
      try {
        const info = await stat(absolute)
        if (info.size > maxBytes) continue
        const content = await readFile(absolute, 'utf8')
        // Separators normalised to POSIX so a node id is identical
        // whether the index was built on Windows or Linux.
        found.push({ path: relative(root, absolute).split(sep).join('/'), content })
      } catch {
        continue
      }
    }
  }

  await descend(root)
  // Sorted so a graph built twice from the same tree is byte-identical,
  // which is what lets a report diff mean something.
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/**
 * State store backed by a file, written atomically.
 *
 * The temp-write-then-rename dance is the whole point. A plain
 * `writeFile` that is interrupted leaves a truncated JSON file, and the
 * next run reads a corrupt index. `rename` within a filesystem is
 * atomic: readers see either the old complete file or the new complete
 * file, never a half-written one.
 */
export function createFileStateStore(path: string): StateStore {
  return {
    async read() {
      try {
        return await readFile(path, 'utf8')
      } catch (cause) {
        // Absent is a legitimate first run; anything else is a real
        // fault the caller should hear about.
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw cause
      }
    },
    async write(contents: string) {
      const temporary = `${path}.tmp`
      await writeFile(temporary, contents, 'utf8')
      await rename(temporary, path)
    },
  }
}
