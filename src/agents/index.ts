import { homedir } from 'node:os';
import { migrateClaude } from './claude.ts';
import { migrateCodex } from './codex.ts';
import type { AgentMigration, MigrateOptions } from './shared.ts';

export type { AgentMigration } from './shared.ts';

/**
 * Move every coding agent's per-project state from `from` to `to`, so that
 * resuming a session still works once the repo lives elsewhere. Each tool is
 * independent: one failing never stops the other.
 */
export async function migrateAgentState(
  from: string,
  to: string,
  options: Partial<MigrateOptions> = {}
): Promise<AgentMigration[]> {
  const resolved: MigrateOptions = {
    dryRun: options.dryRun ?? false,
    home: options.home ?? homedir(),
    env: options.env ?? process.env
  };
  const tools = [
    ['claude', migrateClaude],
    ['codex', migrateCodex]
  ] as const;
  const results: AgentMigration[] = [];
  for (const [tool, migrate] of tools) {
    try {
      results.push(await migrate(from, to, resolved));
    } catch (error) {
      results.push({
        tool,
        changes: [],
        warnings: [(error as Error).message]
      });
    }
  }
  return results;
}
