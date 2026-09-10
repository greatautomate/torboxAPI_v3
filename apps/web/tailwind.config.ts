import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: {
          50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc', 400: '#818cf8',
          500: '#6366f1', 600: '#4f46e5', 700: '#4338ca', 800: '#3730a3', 900: '#312e81', 950: '#1e1b4b',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      spacing: { 'safe-t': 'env(safe-area-inset-top)', 'safe-b': 'env(safe-area-inset-bottom)', 'safe-l': 'env(safe-area-inset-left)', 'safe-r': 'env(safe-area-inset-right)' },
      keyframes: { 'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } }, 'slide-up': { from: { transform: 'translateY(8px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } } },
      animation: { 'fade-in': 'fade-in 150ms ease-out', 'slide-up': 'slide-up 180ms ease-out' },
    },
  },
  plugins: [],
} satisfies Config;
