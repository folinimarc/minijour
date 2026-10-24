import type { Journal } from '../domain/journal';
import { loadDay } from '../domain/day';
import { referencedPhotos } from '../domain/photos';

export type UnusedPhoto = { name: string; size: number };

/** Review is a snapshot of specific files, never permission to delete new orphans. */
export async function unusedPhotos(journal: Journal): Promise<UnusedPhoto[]> {
  await journal.flush();
  const stored = await journal.local.days();
  const references = referencedPhotos([
    ...[...journal.days.values()].map(doc => doc.text),
    ...[...stored.values()].map(bytes => loadDay(bytes).text),
  ]);
  const unused: UnusedPhoto[] = [];
  for (const name of await journal.local.photoNames()) {
    if (references.has(name)) continue;
    const photo = await journal.local.photo(name);
    if (photo) unused.push({ name, size: photo.size });
  }
  return unused;
}
