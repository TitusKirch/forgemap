import type { ForgeMapUserConfig } from './schema.ts';

export type {
  ForgeMapConfig,
  ForgeMapUserConfig,
  ForgeConfig,
  ForgeType
} from './schema.ts';

export function defineForgeMapConfig(
  config: ForgeMapUserConfig
): ForgeMapUserConfig {
  return config;
}
