#!/usr/bin/env node

import { cp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const destination = path.join(codexHome, 'skills', 'qmd-prover');
await mkdir(path.dirname(destination), { recursive: true });
await rm(destination, { recursive: true, force: true });
await cp(path.join(repository, 'skill', 'qmd-prover'), destination, { recursive: true });
await cp(path.join(repository, 'src'), path.join(destination, 'lib'), { recursive: true });
process.stdout.write(`${destination}\n`);
