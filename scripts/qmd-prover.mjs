#!/usr/bin/env node

import { main } from '../src/cli.mjs';

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = error.exitCode ?? 1;
});
