import type {
  ForgeConfig,
  ForgeType,
  GitForgeConfig,
  GitProtocol
} from './schema.ts';

/** Every forge `type` the config schema accepts, in prompt/display order. */
export const FORGE_TYPES: readonly ForgeType[] = [
  'github',
  'gitlab',
  'gitea',
  'codeberg',
  'git'
];

/** Canonical host per forge type, offered as the host prompt's default. The
 *  self-hosted flavors (`gitea`, plain `git`) have no universal host, so none
 *  is suggested for them. */
export const DEFAULT_HOSTS: Partial<Record<ForgeType, string>> = {
  github: 'github.com',
  gitlab: 'gitlab.com',
  codeberg: 'codeberg.org'
};

/** Git clone protocols, in prompt order (`ssh` is the schema default). */
export const GIT_PROTOCOLS: readonly GitProtocol[] = ['ssh', 'https'];

export interface ForgeInput {
  type: ForgeType;
  host: string;
  dir: string;
  /** Only meaningful for `type: 'git'`. `ssh` is the schema default and is
   *  dropped from the written config to keep it minimal — see {@link buildForge}. */
  protocol?: GitProtocol;
}

/**
 * A structurally-loose view of the config used by the in-place mutators below.
 * They run against both plain objects (the create path and unit tests) and
 * magicast proxies (round-trip writes), and the discriminated {@link ForgeConfig}
 * union is too strict to mutate field-by-field — so forges are treated as a flat
 * mutable record here.
 */
export interface MutableForge {
  type: ForgeType;
  host: string;
  dir: string;
  protocol?: GitProtocol;
}

export interface EditableConfig {
  root?: string;
  defaultForge?: string;
  forges?: Record<string, MutableForge>;
}

/** Reject empty / whitespace-only keys; any other string is a valid map key.
 *  Returns an error message, or `null` when the key is acceptable. */
export function validateForgeKey(raw: string): string | null {
  if (raw.trim().length === 0) return 'Forge key must not be empty.';
  return null;
}

/** Whether `value` is one of the schema's forge types (narrows a raw flag). */
export function isForgeType(value: string): value is ForgeType {
  return (FORGE_TYPES as readonly string[]).includes(value);
}

/** Whether `value` is a supported git protocol. */
export function isGitProtocol(value: string): value is GitProtocol {
  return (GIT_PROTOCOLS as readonly string[]).includes(value);
}

/** Build a `ForgeConfig` from collected input, keeping `protocol` only when it
 *  is the non-default (`https`) git protocol. */
export function buildForge(input: ForgeInput): ForgeConfig {
  if (input.type === 'git') {
    const forge: GitForgeConfig = {
      type: 'git',
      host: input.host,
      dir: input.dir
    };
    if (input.protocol === 'https') forge.protocol = 'https';
    return forge;
  }
  // The non-git members are each just `BaseForgeConfig` with a fixed `type`; a
  // union-typed `type` field can't be expressed as an object literal, so assert
  // the shape (the `type` value is already narrowed to a non-git literal here).
  return { type: input.type, host: input.host, dir: input.dir } as ForgeConfig;
}

export function addForge(
  config: EditableConfig,
  key: string,
  forge: MutableForge
): void {
  if (!config.forges) config.forges = {};
  config.forges[key] = forge;
}

export function removeForge(config: EditableConfig, key: string): void {
  if (config.forges) delete config.forges[key];
}

export function setDefaultForge(config: EditableConfig, key: string): void {
  config.defaultForge = key;
}

export interface ForgePatch {
  type?: ForgeType;
  host?: string;
  dir?: string;
  /** `null` clears the protocol; `undefined` leaves it untouched. */
  protocol?: GitProtocol | null;
}

/** Apply a partial change to an existing forge in place. Clears `protocol`
 *  whenever the resulting type is not `git`, since it is meaningless there. */
export function editForge(
  config: EditableConfig,
  key: string,
  patch: ForgePatch
): void {
  const forge = config.forges?.[key];
  if (!forge) return;
  if (patch.type !== undefined) forge.type = patch.type;
  if (patch.host !== undefined) forge.host = patch.host;
  if (patch.dir !== undefined) forge.dir = patch.dir;
  if (forge.type !== 'git') {
    delete forge.protocol;
  } else if (patch.protocol === null) {
    delete forge.protocol;
  } else if (patch.protocol !== undefined) {
    forge.protocol = patch.protocol;
  }
}
