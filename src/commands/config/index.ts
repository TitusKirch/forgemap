import { defineCommand } from 'citty';
import { configInitCommand } from './init.ts';
import { configShowCommand } from './show.ts';

export const configCommand = defineCommand({
  meta: {
    name: 'config',
    description: 'Manage the forgemap config file'
  },
  subCommands: {
    init: configInitCommand,
    show: configShowCommand
  }
});
