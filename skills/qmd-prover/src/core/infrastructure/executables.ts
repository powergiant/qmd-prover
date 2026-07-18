import { access, constants } from 'node:fs/promises';
import path from 'node:path';

export async function executableAvailable(command: string): Promise<boolean> {
  const candidates = command.includes(path.sep)
    ? [path.resolve(command)]
    : String(process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, command));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return true;
    } catch { /* Try the next PATH entry. */ }
  }
  return false;
}
