// defineConfig من vitest/config: يضمن نوع مفتاح `test` مع Vitest 5 (وهو يعيد تصدير defineConfig الخاصة بـVite).
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    testTimeout: 60000,
  },
})
