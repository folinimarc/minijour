// Used only by the tag workflow. GitHub CLI reads GH_TOKEN from its environment.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { readRelease } from './check-release.mjs';

try {
  const tag = process.env.GITHUB_REF_NAME || '';
  const { version } = readRelease(tag);
  const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  // List first: a network/auth error must not be mistaken for a missing release.
  const releases = JSON.parse(gh('api', '--paginate', '--slurp', `repos/${process.env.GITHUB_REPOSITORY}/releases`)).flat();
  const existing = releases.find(release => release.tag_name === tag);
  if (existing && !existing.draft) {
    mkdirSync('.release/published', { recursive: true });
    gh('release', 'download', tag, '--pattern', 'SHA256SUMS', '--dir', '.release/published', '--clobber');
    if (readFileSync('.release/published/SHA256SUMS', 'utf8') !== readFileSync('.release/SHA256SUMS', 'utf8')) {
      throw new Error('Published release checksums differ. Never replace published assets; create a new version.');
    }
    console.log('This exact release is already published. Keeping its immutable assets.');
  } else {
    if (!existing) gh('release', 'create', tag, '--draft', '--verify-tag', '--title', `minijour ${version}`, '--notes-file', '.release/release-notes.md');
    gh('release', 'upload', tag, `.release/minijour-${version}-site.zip`, `.release/minijour-${version}-source.tar.gz`, '.release/SHA256SUMS', '--clobber');
    gh('release', 'edit', tag, '--draft=false', '--notes-file', '.release/release-notes.md');
    console.log(`Published ${tag}.`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
