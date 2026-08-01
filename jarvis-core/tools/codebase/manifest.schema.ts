import { z } from 'zod'

// Schema for docs/codebase/MANIFEST.json — navigation metadata only.
// Every entry references a source path; no source code, no SQL, no secrets.
// `_generated` marks which top-level sections the generator owns; anything
// else comes from tools/codebase/annotations.json and is human-owned.

const modulePath = z.string().min(1)

export const moduleEntrySchema = z.object({
  name: z.string(),
  path: modulePath,
  exports: z.array(z.string()),
  dependsOn: z.array(z.string()),
  consumers: z.array(z.string()),
  tests: z.array(modulePath),
  // manual annotation fields (merged from annotations.json)
  purpose: z.string(),
  securitySensitivity: z.enum(['critical', 'sensitive', 'ordinary']),
  stability: z.enum(['stable', 'changing', 'temporary']),
})

export const securityCriticalFileSchema = z.object({
  path: modulePath,
  class: z.enum(['critical', 'sensitive']),
  concern: z.string(),
  requiredTests: z.array(modulePath),
})

export const manifestSchema = z.object({
  version: z.literal('1'),
  generatedAt: z.string(),
  repositoryCommit: z.string().regex(/^[0-9a-f]{40}$/),
  _generated: z.array(z.string()),
  modules: z.array(moduleEntrySchema),
  securityCriticalFiles: z.array(securityCriticalFileSchema),
  databaseMigrations: z.array(z.object({ path: modulePath, sha256: z.string().length(64) })),
  agents: z.array(z.object({ code: z.string(), business: z.string().nullable() })),
  businesses: z.array(z.object({ code: z.string(), name: z.string() })),
  routes: z.array(z.object({ route: z.string(), path: modulePath, kind: z.enum(['page', 'api']) })),
  internalTools: z.array(z.object({ name: z.string(), path: modulePath })),
  tests: z.array(modulePath),
  dependencyGraph: z.array(z.object({ from: z.string(), to: z.string() })),
  canonicalSources: z.record(z.string(), z.string()),
})

export type Manifest = z.infer<typeof manifestSchema>
export type ModuleEntry = z.infer<typeof moduleEntrySchema>

export const annotationsSchema = z.object({
  modules: z.record(
    z.string(),
    z.object({
      purpose: z.string(),
      securitySensitivity: z.enum(['critical', 'sensitive', 'ordinary']),
      stability: z.enum(['stable', 'changing', 'temporary']),
    })
  ),
  securityCriticalFiles: z.array(securityCriticalFileSchema),
  canonicalSources: z.record(z.string(), z.string()),
  /** Allowed internal dependencies per module — anything else is a violation. */
  layerRules: z.record(z.string(), z.array(z.string())),
  /** Paths matching these globs must appear in securityCriticalFiles. */
  securityPathPatterns: z.array(z.string()),
})

export type Annotations = z.infer<typeof annotationsSchema>
