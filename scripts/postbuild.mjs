import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');

copyFileSync(join(root, 'README.md'), join(dist, 'README.md'));
copyFileSync(join(root, 'LICENSE'), join(dist, 'LICENSE'));

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const publishable = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  license: pkg.license,
  type: pkg.type,
  author: pkg.author,
  contributors: pkg.contributors,
  repository: pkg.repository,
  bugs: pkg.bugs,
  homepage: pkg.homepage,
  keywords: pkg.keywords,
  engines: pkg.engines,
  publishConfig: pkg.publishConfig,
  peerDependencies: pkg.peerDependencies,
  peerDependenciesMeta: pkg.peerDependenciesMeta,
  exports: {
    '.': {
      types: './index.d.ts',
      import: './index.js',
      require: './index.cjs',
    },
    './nestjs': {
      types: './nestjs/index.d.ts',
      import: './nestjs/index.js',
      require: './nestjs/index.cjs',
    },
    './cli': {
      types: './cli/index.d.ts',
      import: './cli/index.js',
      require: './cli/index.cjs',
    },
  },
  bin: {
    schemigrate: './cli/bin.js',
  },
};

writeFileSync(join(dist, 'package.json'), `${JSON.stringify(publishable, null, 2)}\n`);
