import type { Config } from 'tailwindcss'

export default {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: '#0b0e14',
        panel: '#12161f',
        edge: '#1f2633',
        accent: '#4f8cff',
        gold: '#c8a24a',
        danger: '#e5484d',
        ok: '#30a46c',
        warn: '#f5a524',
        muted: '#8b93a5',
      },
    },
  },
  plugins: [],
} satisfies Config
