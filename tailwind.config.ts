import type { Config } from 'tailwindcss'

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink:    '#0A0A0A',   // primary background
        char:   '#141414',   // card background
        bone:   '#EDE6D6',   // primary text (warm cream)
        ash:    '#8A8578',   // secondary text
        blood:  '#8B0000',   // accent (deep red)
        rust:   '#B45309',   // secondary accent (aged copper)
        line:   '#1F1F1F',   // borders
      },
      fontFamily: {
        serif: ['Playfair Display', 'Georgia', 'serif'],
        sans:  ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config
