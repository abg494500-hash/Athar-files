import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * بناء نسخة «الأرشيف للقراءة فقط»: ملف JS كلاسيكي واحد (IIFE) وملف CSS واحد بخطوطه وصوره مدمجة،
 * ليعمل بالنقر المزدوج من file:// دون خادم ودون إنترنت (وحدات ES ووسم crossorigin لا تعمل هناك).
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  publicDir: false,
  define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'import.meta.env.VITE_TEACHER_API_URL': 'undefined' },
  build: {
    outDir: 'public/archive-app', emptyOutDir: true, target: 'es2019', assetsInlineLimit: 100_000_000, cssCodeSplit: false, sourcemap: false, minify: 'esbuild',
    lib: { entry: 'src/archive/main.tsx', formats: ['iife'], name: 'AtharArchive', fileName: () => 'app.js', cssFileName: 'app' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
