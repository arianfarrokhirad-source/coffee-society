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
    '@jarvis/integrations',
    '@jarvis/permissions',
    '@jarvis/reporting',
    '@jarvis/security',
    '@jarvis/shared',
    '@jarvis/ui',
    '@jarvis/workflows',
  ],
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
