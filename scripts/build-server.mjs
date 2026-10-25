import { build } from 'vite'
await build({
  configFile: false,
  publicDir: false,
  build: {
    ssr: 'server/app.ts',
    outDir: 'server-dist',
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: 'app.mjs' } },
  },
  ssr: { noExternal: true },
})
