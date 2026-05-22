import type { ForgeType } from '../config/schema.ts';
import { githubAdapter } from './github.ts';
import type { ForgeAdapter } from './types.ts';

export function getForgeAdapter(type: ForgeType): ForgeAdapter {
  switch (type) {
    case 'github':
      return githubAdapter;
    case 'gitlab':
    case 'gitea':
    case 'codeberg':
      throw new Error(
        `Forge type "${type}" is not implemented yet. Only "github" is supported in this release.`
      );
    default: {
      const exhaustive: never = type;
      throw new Error(`Unknown forge type: ${String(exhaustive)}`);
    }
  }
}
