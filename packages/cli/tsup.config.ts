import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  // The bin must be directly executable, and @oya/browser is bundled in so
  // `npx oya` is one download rather than two.
  banner: { js: '#!/usr/bin/env node' },
  noExternal: ['@oya/browser'],
});
