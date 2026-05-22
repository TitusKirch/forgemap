import { defineCommand } from 'citty';
import { cloneCommand } from './commands/clone.ts';
import { configCommand } from './commands/config/index.ts';
import { pathCommand } from './commands/path.ts';
import { pickCommand } from './commands/pick.ts';
import { searchCommand } from './commands/search.ts';
import { shellInitCommand } from './commands/shell-init.ts';

export const rootCommand = defineCommand({
  meta: {
    name: 'forgemap',
    description:
      'Manage a local repo layout of the form <root>/<forge.dir>/<owner>/<repo>'
  },
  subCommands: {
    clone: cloneCommand,
    path: pathCommand,
    search: searchCommand,
    pick: pickCommand,
    'shell-init': shellInitCommand,
    config: configCommand
  }
});
