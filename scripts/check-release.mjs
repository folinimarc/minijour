import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Fail closed before a tag can publish an incorrectly labelled build. */
export function checkRelease(tag, pkg, lock, changelog) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
    throw new Error('Release tags must be stable SemVer tags such as v0.1.0.');
  }
  const version = tag.slice(1);
  if (pkg.version !== version || lock.version !== version || lock.packages[''].version !== version) {
    throw new Error('The tag, package.json, and package-lock.json versions must match.');
  }
  const lines = changelog.split(/\r?\n/);
  const heading = new RegExp(`^## ${version.replaceAll('.', '\\.')} - \\d{4}-\\d{2}-\\d{2}$`);
  const start = lines.findIndex(line => heading.test(line));
  if (start < 0) throw new Error(`Add a dated CHANGELOG.md section: ## ${version} - YYYY-MM-DD`);
  const nextHeading = lines.findIndex((line, index) => index > start && /^## /.test(line));
  const notes = lines.slice(start + 1, nextHeading < 0 ? undefined : nextHeading).join('\n').trim();
  if (!notes) throw new Error('Release notes must describe what changed.');
  return { version, notes };
}

export function readRelease(tag) {
  return checkRelease(tag,
    JSON.parse(readFileSync('package.json', 'utf8')),
    JSON.parse(readFileSync('package-lock.json', 'utf8')),
    readFileSync('CHANGELOG.md', 'utf8'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const release = readRelease(process.argv[2] || process.env.GITHUB_REF_NAME || '');
    mkdirSync('.release', { recursive: true });
    writeFileSync('.release/release-notes.md', release.notes + '\n');
    console.log(`Release ${release.version} matches its package, lockfile, and changelog.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
