
import type { Config } from 'tailwindcss'
export default {
  content: ['./index.html','./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#22c55e',
          dark: '#16a34a',
          light: '#bbf7d0'
        }
      },
      borderRadius: {
        xl2: '1.25rem'
      }
    }
  },
  plugins: []
} satisfies Config
