import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'nestjs/index': 'src/nestjs/index.ts',
    'cli/index': 'src/cli/index.ts',
    'cli/bin': 'src/cli/bin.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  esbuildOptions(options) {
    // Node supports dynamic import() in CJS: keep it untouched so the CLI
    // can load .mjs/.ts config files from the CJS build too.
    options.supported = { ...options.supported, 'dynamic-import': true };
  },
  sourcemap: true,
  clean: true,
  target: 'node18',
  // Peer/runtime dependencies stay external — never bundled.
  external: [
    'mongoose',
    'mongodb',
    '@nestjs/common',
    '@nestjs/core',
    '@nestjs/mongoose',
    'reflect-metadata',
    'rxjs',
  ],
});
