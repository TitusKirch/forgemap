import { defineCommand } from 'citty';
import { forgeAddCommand } from './add.ts';
import { forgeEditCommand } from './edit.ts';
import { forgeRemoveCommand } from './remove.ts';

export const forgeCommand = defineCommand({
  meta: {
    name: 'forge',
    description: 'Add, remove or edit forges in the config'
  },
  subCommands: {
    add: forgeAddCommand,
    remove: forgeRemoveCommand,
    edit: forgeEditCommand
  }
});
