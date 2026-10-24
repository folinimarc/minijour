// Preserve the license notices for the runtime packages shipped in the browser.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function dependencyNotices(root = process.cwd()) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const notices = ['Third-party software included in minijour. Each package retains its own license.\n'];
  for (const [path, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
    if (!path.startsWith('node_modules/') || entry.dev || entry.devOptional) continue;
    const directory = join(root, path);
    if (!existsSync(directory)) continue; // Platform-specific optional packages.
    const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const files = readdirSync(directory).filter(name => /^(licen[cs]e|copying|notice)([.\-_]|$)/i.test(name)).sort();
    if (!files.length) throw new Error(`Missing license notice for ${pkg.name}. Review before distributing.`);
    notices.push(`\n${'='.repeat(72)}\n${pkg.name}@${pkg.version}\nLicense: ${pkg.license}\n`);
    for (const file of files) notices.push(`\n--- ${file} ---\n${readFileSync(join(directory, file), 'utf8')}\n`);
  }
  return notices.join('');
}
