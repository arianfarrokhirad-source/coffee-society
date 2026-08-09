import { resolve } from 'node:path'
import { createVault, createVaultFs } from '@jarvis/obsidian'

// CLI for the Obsidian vault.
//
//   npm run vault:check              validate the whole vault
//   npm run vault:search -- "terms"  search notes
//   npm run vault:list -- adr        list notes of a type
//
// Read and validate only. Capture goes through the application so that
// every agent write lands in 00-inbox as unreviewed — a CLI that could
// write reviewed notes would route around the one rule that keeps the
// vault from degrading into a cache.

const ROOT = resolve(import.meta.dirname, '../..')
const VAULT_PATH = process.env.JARVIS_VAULT_PATH ?? resolve(ROOT, 'farrokhirad-vault')

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)
  const vault = createVault(createVaultFs(VAULT_PATH))

  if (command === 'search') {
    const hits = await vault.search(rest.join(' '))
    if (hits.length === 0) {
      console.log('No matches.')
      return
    }
    for (const hit of hits.slice(0, 10)) {
      // Provenance on every result: path, type and date, so the caller
      // can judge freshness without opening the file.
      console.log(
        `${hit.note.path}  [${hit.note.frontmatter.type}` +
          `${hit.note.frontmatter.date ? ` ${String(hit.note.frontmatter.date)}` : ''}]  score ${hit.score}`
      )
      if (hit.excerpts[0]) console.log(`    …${hit.excerpts[0]}…`)
    }
    return
  }

  if (command === 'list') {
    const notes = rest[0]
      ? await vault.query({ type: rest[0] as Parameters<typeof vault.query>[0]['type'] })
      : await vault.notes()
    for (const note of notes) {
      console.log(
        `${note.frontmatter.type.padEnd(9)} ${String(note.frontmatter.title ?? note.slug)}  (${note.path})`
      )
    }
    console.log(`\n${notes.length} note(s).`)
    return
  }

  // Default: validate.
  const notes = await vault.notes()
  const issues = await vault.validate()

  console.log(`Vault: ${VAULT_PATH}`)
  console.log(`${notes.length} note(s) indexed.`)

  const byType: Record<string, number> = {}
  for (const note of notes) {
    byType[note.frontmatter.type] = (byType[note.frontmatter.type] ?? 0) + 1
  }
  console.log(
    Object.entries(byType)
      .map(([type, count]) => `${type} ${count}`)
      .join(' · ')
  )

  if (issues.length === 0) {
    console.log('\nNo issues.')
    return
  }

  const errors = issues.filter((issue) => issue.severity === 'error')
  console.log('')
  for (const issue of issues) {
    console.log(`${issue.severity.toUpperCase().padEnd(7)} ${issue.path}: ${issue.message}`)
  }
  console.log(`\n${errors.length} error(s), ${issues.length - errors.length} warning(s).`)

  // Errors fail the build; warnings do not. A broken wikilink is worth
  // seeing but is not worth blocking a merge over.
  if (errors.length > 0) process.exitCode = 1
}

main().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : cause)
  process.exitCode = 1
})
