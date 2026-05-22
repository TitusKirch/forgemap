import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`)
]);

const runtimeDeps = ['citty', 'c12', 'defu', 'pathe', 'consola'];

export default defineConfig({
  build: {
    target: 'node24',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      entry: {
        'bin/forgemap': resolve(__dirname, 'src/bin/forgemap.ts'),
        'config/define': resolve(__dirname, 'src/config/define.ts'),
        index: resolve(__dirname, 'src/index.ts')
      },
      formats: ['es']
    },
    rollupOptions: {
      external: (id) => {
        if (nodeBuiltins.has(id)) return true;
        if (runtimeDeps.some((dep) => id === dep || id.startsWith(`${dep}/`))) {
          return true;
        }
        return false;
      },
      output: {
        entryFileNames: '[name].mjs',
        chunkFileNames: 'chunks/[name]-[hash].mjs',
        banner: (chunk) => {
          if (chunk.name === 'bin/forgemap') {
            return '#!/usr/bin/env node';
          }
          return '';
        }
      }
    }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
});
