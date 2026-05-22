export type ForgeType = 'github' | 'gitlab' | 'gitea' | 'codeberg';

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

export type ForgeConfig =
  | GitHubForgeConfig
  | GitLabForgeConfig
  | GiteaForgeConfig
  | CodebergForgeConfig;

export interface ForgeMapConfig {
  root: string;
  defaultForge: string;
  forges: Record<string, ForgeConfig>;
}

export type ForgeMapUserConfig = Partial<ForgeMapConfig> & {
  forges?: Record<string, ForgeConfig>;
};
