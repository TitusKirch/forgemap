export type ForgeType = 'github' | 'gitlab' | 'gitea' | 'codeberg' | 'git';

export type GitProtocol = 'ssh' | 'https';

export interface BaseForgeConfig {
  type: ForgeType;
  host: string;
  dir: string;
}

export interface GitHubForgeConfig extends BaseForgeConfig {
  type: 'github';
}

export interface GitLabForgeConfig extends BaseForgeConfig {
  type: 'gitlab';
}

export interface GiteaForgeConfig extends BaseForgeConfig {
  type: 'gitea';
}

export interface CodebergForgeConfig extends BaseForgeConfig {
  type: 'codeberg';
}

export interface GitForgeConfig extends BaseForgeConfig {
  type: 'git';
  /** Default git URL protocol when cloning. SSH unless overridden. */
  protocol?: GitProtocol;
}

export type ForgeConfig =
  | GitHubForgeConfig
  | GitLabForgeConfig
  | GiteaForgeConfig
  | CodebergForgeConfig
  | GitForgeConfig;

export interface ForgeMapConfig {
  root: string;
  defaultForge: string;
  forges: Record<string, ForgeConfig>;
}

export type ForgeMapUserConfig = Partial<ForgeMapConfig> & {
  forges?: Record<string, ForgeConfig>;
};
