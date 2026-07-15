import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
// From vitest/config, not vite: vitest 4 no longer augments vite's UserConfig
// with the `test` key, so vite's own defineConfig rejects it.
import { defineConfig } from 'vitest/config';

const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`)
]);

const runtimeDeps = ['citty', 'c12', 'defu', 'pathe', 'consola', 'fuse.js'];

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
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/bin/**',
        'src/index.ts',
        'src/cli.ts',
        'src/commands/config/index.ts',
        'src/config/define.ts',
        'src/config/schema.ts',
        'src/forges/types.ts'
      ],
      // text+html for local use; json + json-summary feed the PR-comment action
      // (davelosert/vitest-coverage-report-action). No lcov (was only for Codecov).
      reporter: ['text', 'html', 'json', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90
      }
    }
  }
});
