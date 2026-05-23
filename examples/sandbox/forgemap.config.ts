/**
 * Sandbox config — use it from the CLI:
 *   cd examples/sandbox
 *   forgemap config show
 *   forgemap path kirchDev/laravel-pbac
 *
 * `root: '.'` resolves against this file's directory, so everything
 * lands under examples/sandbox/ (ignored by .gitignore).
 *
 * @type {import('forgemap').ForgeMapUserConfig}
 */
export default {
  root: '.',
  defaultForge: 'github',
  forges: {
    github: {
      type: 'github',
      host: 'github.com',
      dir: 'comGithub'
    },
    vanilla: {
      // Plain `git clone` against any host — no gh required.
      type: 'git',
      host: 'gitlab.example.com',
      dir: 'comGitlabExample',
      protocol: 'ssh'
    }
  }
};
