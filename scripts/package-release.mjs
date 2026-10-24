// Package the tested build and its exact committed source. Never rebuild here.
import { readFileSync, readdirSync, mkdirSync, writeFileSync, statSync, utimesSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';
import { readRelease } from './check-release.mjs';

try {
  const tag = process.argv[2] || process.env.GITHUB_REF_NAME || '';
  const { version } = readRelease(tag);
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  if (git('status', '--porcelain')) throw new Error('Commit all source changes before packaging a release.');
  const sourceCommit = git('rev-parse', 'HEAD');
  if (git('rev-parse', `${tag}^{commit}`) !== sourceCommit) throw new Error('Check out the release tag before packaging.');
  const metadata = JSON.parse(readFileSync('dist/build.json', 'utf8'));
  if (metadata.version !== version || metadata.sourceCommit !== sourceCommit) {
    throw new Error('The static build does not match this version and source commit. Build the tagged checkout first.');
  }
  for (const file of ['index.html', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.txt']) readFileSync(join('dist', file));
  const files = {};
  function collect(directory) {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) collect(path);
      else files[relative('dist', path).replaceAll('\\', '/')] = new Uint8Array(readFileSync(path));
    }
  }
  collect('dist');
  mkdirSync('.release', { recursive: true });
  const site = `minijour-${version}-site.zip`;
  const source = `minijour-${version}-source.tar.gz`;
  // A fixed ZIP timestamp makes retries produce the same archive/checksum.
  writeFileSync(join('.release', site), zipSync(files, { level: 9, mtime: new Date('1980-01-01T00:00:00Z') }));
  // Include provenance in the source archive so it remains buildable without Git.
  writeFileSync('.release/source-revision.json', JSON.stringify({ sourceCommit }, null, 2) + '\n');
  const commitTime = Number(git('show', '-s', '--format=%ct', 'HEAD'));
  utimesSync('.release/source-revision.json', commitTime, commitTime);
  execFileSync('git', ['archive', '--format=tar.gz', `--prefix=minijour-${version}/`, `--output=.release/${source}`, '--add-file=.release/source-revision.json', 'HEAD']);
  const checksums = [site, source].map(name => `${createHash('sha256').update(readFileSync(join('.release', name))).digest('hex')}  ${name}`);
  writeFileSync('.release/SHA256SUMS', checksums.join('\n') + '\n');
  console.log(`Packaged ${tag} from ${sourceCommit}: static site, source, and SHA-256 checksums.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
