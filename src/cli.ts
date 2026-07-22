import { defineCommand } from 'citty';
import { cdCommand } from './commands/cd.ts';
import { cleanupCommand } from './commands/cleanup.ts';
import { cloneCommand } from './commands/clone.ts';
import { completionCommand } from './commands/completion.ts';
import { configCommand } from './commands/config/index.ts';
import { deleteCommand } from './commands/delete.ts';
import { forgeCommand } from './commands/forge/index.ts';
import { importCommand } from './commands/import.ts';
import { infoCommand } from './commands/info.ts';
import { listCommand } from './commands/list.ts';
import { openCommand } from './commands/open.ts';
import { pathCommand } from './commands/path.ts';
import { pickCommand } from './commands/pick.ts';
import { shellInitCommand } from './commands/shell-init.ts';
import { statusCommand } from './commands/status.ts';
import { syncCommand } from './commands/sync.ts';
import { validateCommand } from './commands/validate.ts';

// Injected at build time by vite's `define` (see vite.config.ts), sourced from
// package.json's `version`. release-please bumps that field on release, so the
// reported version tracks the published one instead of a hand-copied literal
// that would silently drift.
declare const __APP_VERSION__: string;

export const rootCommand = defineCommand({
  meta: {
    name: 'forgemap',
    version: __APP_VERSION__,
    description:
      'Manage a local repo layout of the form <root>/<forge.dir>/<owner>/<repo>'
  },
  subCommands: {
    clone: cloneCommand,
    import: importCommand,
    cleanup: cleanupCommand,
    delete: deleteCommand,
    cd: cdCommand,
    path: pathCommand,
    open: openCommand,
    list: listCommand,
    pick: pickCommand,
    status: statusCommand,
    sync: syncCommand,
    validate: validateCommand,
    info: infoCommand,
    completion: completionCommand,
    'shell-init': shellInitCommand,
    config: configCommand,
    forge: forgeCommand
  }
});
