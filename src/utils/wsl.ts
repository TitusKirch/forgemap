/**
 * Build a `file://` URL that opens in the host OS, with WSL2 awareness.
 *
 * On WSL2, plain `file:///root/foo` points at the WSL filesystem from
 * Windows's point of view — clicking from Windows Terminal won't open
 * anything. We translate the path into the UNC form Windows can follow:
 * `\\wsl$\<distro>\root\foo`, rendered as `file:////wsl$/<distro>/...`
 * (the 4-slash form: scheme + empty authority + UNC path).
 *
 * Outside WSL, returns plain `file://<absolute-path>`.
 */
export function isWsl(): boolean {
  return Boolean(process.env.WSL_DISTRO_NAME);
}

export function toFileUrl(absolutePath: string): string {
  const distro = process.env.WSL_DISTRO_NAME;
  if (distro) {
    return `file:////wsl$/${distro}${absolutePath}`;
  }
  return `file://${absolutePath}`;
}
