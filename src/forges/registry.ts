import type { ForgeType } from '../config/schema.ts';
import { gitAdapter } from './git.ts';
import { githubAdapter } from './github.ts';
import type { ForgeAdapter } from './types.ts';

export function getForgeAdapter(type: ForgeType): ForgeAdapter {
  switch (type) {
    case 'github':
      return githubAdapter;
    case 'git':
      return gitAdapter;
    case 'gitlab':
    case 'gitea':
    case 'codeberg':
      throw new Error(
        `Forge type "${type}" is not implemented yet. Use type: 'git' for a vanilla git-clone fallback.`
      );
    default: {
      const exhaustive: never = type;
      throw new Error(`Unknown forge type: ${String(exhaustive)}`);
    }
  }
}
