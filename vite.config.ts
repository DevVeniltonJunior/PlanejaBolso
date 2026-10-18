import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the app under /<repository>/. Override with BASE_PATH if needed.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/PlanejaBolso/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: { react: ['react', 'react-dom', 'react-dom/client', 'react-router-dom'], supabase: ['@supabase/supabase-js'] },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
