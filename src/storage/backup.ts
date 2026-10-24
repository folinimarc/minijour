import * as A from '@automerge/automerge';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { isDate, loadDay, markdown } from '../domain/day';
import type { Journal } from '../domain/journal';
import { PHOTO_NAME, referencedPhotos, encodePhotoDeletions, decodePhotoDeletions } from '../domain/photos';

const DAY_FILE = /^minijour\/\d{4}-\d{2}-\d{2}\.automerge$/;
const DELETIONS_FILE = 'minijour/photo-deletions.json';

/** A portable ZIP holds current Markdown/photos, text history, and deletion metadata. */
export async function exportJournal(journal: Journal): Promise<Blob> {
  const days = new Map(journal.days);
  const files: Record<string, Uint8Array> = {
    'journal.md': strToU8(markdown(days)),
    'README.txt': strToU8('journal.md and photos/ are readable in any Markdown editor.\nOnly photos referenced in the current Markdown are included.\nTo restore text editing history and permanent photo deletion records in minijour, import this entire ZIP.\nPast photo references in editing history may have no image.\nDropbox credentials and encryption keys are never included.\n'),
  };
  const deleted = await journal.local.photoDeletions();
  if (deleted.size) files[DELETIONS_FILE] = encodePhotoDeletions(deleted);
  for (const [date, doc] of days) files[`minijour/${date}.automerge`] = A.save(doc);
  for (const name of referencedPhotos([...days.values()].map(doc => doc.text))) {
    const photo = await journal.local.photo(name);
    if (photo) files[`photos/${name}`] = new Uint8Array(await photo.arrayBuffer());
  }
  return new Blob([new Uint8Array(zipSync(files, { level: 0 }))], { type: 'application/zip' });
}

export async function importJournal(journal: Journal, file: File): Promise<void> {
  if (file.size > 250 * 1024 * 1024) throw new Error('This backup is too large to restore in the browser (250 MB maximum).');
  let totalSize = 0;
  // Bound the uncompressed data before allocating it (including ZIP bombs).
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter(entry) {
      totalSize += entry.originalSize;
      if (totalSize > 500 * 1024 * 1024) throw new Error('The expanded backup is too large (500 MB maximum).');
      return DAY_FILE.test(entry.name) || entry.name === DELETIONS_FILE
        || (entry.name.startsWith('photos/') && PHOTO_NAME.test(entry.name.slice(7)));
    },
  });
  const days = Object.entries(files).filter(([path]) => DAY_FILE.test(path));
  if (!days.length) throw new Error('Choose a minijour backup ZIP containing its editing history.');
  // Validate every day before importing anything. Restore merges, never replaces.
  for (const [path, bytes] of days) {
    if (!isDate(path.slice(9, 19))) throw new Error('The backup contains an invalid date.');
    loadDay(bytes);
  }
  const deleted = files[DELETIONS_FILE] ? decodePhotoDeletions(files[DELETIONS_FILE]) : [];
  await journal.deletePhotos(deleted);
  for (const [path, bytes] of Object.entries(files)) {
    if (path.startsWith('photos/')) {
      await journal.local.savePhoto(path.slice(7), new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
    }
  }
  for (const [path, bytes] of days) await journal.merge(path.slice(9, 19), bytes);
  journal.photosChanged();
}
