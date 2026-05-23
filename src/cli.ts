import { defineCommand } from 'citty';
import { cdCommand } from './commands/cd.ts';
import { cloneCommand } from './commands/clone.ts';
import { completionCommand } from './commands/completion.ts';
import { configCommand } from './commands/config/index.ts';
import { openCommand } from './commands/open.ts';
import { pathCommand } from './commands/path.ts';
import { pickCommand } from './commands/pick.ts';
import { searchCommand } from './commands/search.ts';
import { shellInitCommand } from './commands/shell-init.ts';
import { statusCommand } from './commands/status.ts';
import { syncCommand } from './commands/sync.ts';
import { validateCommand } from './commands/validate.ts';

export const rootCommand = defineCommand({
  meta: {
    name: 'forgemap',
    description:
      'Manage a local repo layout of the form <root>/<forge.dir>/<owner>/<repo>'
  },
  subCommands: {
    clone: cloneCommand,
    cd: cdCommand,
    path: pathCommand,
    open: openCommand,
    search: searchCommand,
    pick: pickCommand,
    status: statusCommand,
    sync: syncCommand,
    validate: validateCommand,
    completion: completionCommand,
    'shell-init': shellInitCommand,
    config: configCommand
  }
});
