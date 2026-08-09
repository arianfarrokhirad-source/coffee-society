import type { NextConfig } from 'next'

// Security headers applied to every response. CSP allows only self-hosted
// assets; Next.js requires 'unsafe-inline' for its bootstrapping script and
// styles in the app router without nonce plumbing (acceptable for a private,
// authenticated tool — tighten with nonces if the surface becomes public).
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  },
]

const nextConfig: NextConfig = {
  transpilePackages: [
    '@jarvis/agents',
    '@jarvis/ai',
    '@jarvis/database',
    '@jarvis/graphify',
    '@jarvis/integrations',
    '@jarvis/obsidian',
    '@jarvis/permissions',
    '@jarvis/reporting',
    '@jarvis/security',
    '@jarvis/shared',
    '@jarvis/ui',
    '@jarvis/workflows',
  ],
  // The vault is read from disk at request time, and Next.js only ships
  // files it can see being imported. Markdown opened through a computed
  // path is invisible to that analysis, so without this the /knowledge
  // page would work locally and find an empty vault in production —
  // the failure mode that looks like a data problem and is a build one.
  outputFileTracingIncludes: {
    '/knowledge': ['../../farrokhirad-vault/**/*.md'],
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
