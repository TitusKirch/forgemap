import type { ForgeConfig, GitProtocol } from '../config/schema.ts';

export interface CloneOptions {
  forge: ForgeConfig;
  owner: string;
  repo: string;
  dest: string;
  /** Override the URL protocol for this clone (git adapter only). */
  protocol?: GitProtocol;
}

export interface ForgeAdapter {
  clone(options: CloneOptions): Promise<void>;
}
