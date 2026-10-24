import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** Source archives can be rebuilt without a .git directory. */
export function buildInfo(root = process.cwd()) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  let sourceCommit = null;
  try {
    sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    try { sourceCommit = JSON.parse(readFileSync(join(root, 'source-revision.json'), 'utf8')).sourceCommit; }
    catch { /* GitHub's automatic source archives have no additional metadata. */ }
  }
  const repository = process.env.GITHUB_REPOSITORY
    ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
    : pkg.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '') || 'https://github.com/folinimarc/minijour';
  return {
    version: pkg.version,
    sourceCommit,
    sourceUrl: `${repository}/tree/${sourceCommit || `v${pkg.version}`}`,
  };
}
