import type { ForgeConfig } from '../config/schema.ts';

export interface CloneOptions {
  forge: ForgeConfig;
  owner: string;
  repo: string;
  dest: string;
}

export interface ForgeAdapter {
  clone(options: CloneOptions): Promise<void>;
}
