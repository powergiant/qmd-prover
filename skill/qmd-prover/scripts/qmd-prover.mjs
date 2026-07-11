#!/usr/bin/env node

import { access } from 'node:fs/promises';

const installed = new URL('../lib/cli.mjs', import.meta.url);
const development = new URL('../../../src/cli.mjs', import.meta.url);
let entry = installed;
try { await access(installed); } catch { entry = development; }
const { main } = await import(entry);

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = error.exitCode ?? 1;
});
