export const PHOTO_NAME = /^[a-f0-9-]{36}\.jpg$/;
export const PHOTO_DELETION_PATH = /^\/deleted-photos\/([a-f0-9-]{36}\.jpg)\.json$/;

/** Be conservative: keep a photo if its path occurs anywhere in current text,
 * including reference-style links, link titles, and Markdown code examples.
 * Cleanup must not depend on the narrower syntax used by inline previews.
 */
export function referencedPhotos(texts: Iterable<string>): Set<string> {
  const names = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(/\bphotos\/([a-f0-9-]{36}\.jpg)(?![a-z0-9._-])/gi)) names.add(match[1].toLowerCase());
  }
  return names;
}

// A grow-only set: a permanent deletion has no conflicting update to resolve.
// The same format is used for one-photo cloud records and backup metadata.
export function encodePhotoDeletions(names: Iterable<string>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ version: 1, photos: [...new Set(names)].sort() }));
}

export function decodePhotoDeletions(bytes: Uint8Array): string[] {
  const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (record?.version !== 1 || !Array.isArray(record.photos)
    || !record.photos.every((name: unknown) => typeof name === 'string' && PHOTO_NAME.test(name))) {
    throw new Error('Invalid photo deletion record.');
  }
  return [...new Set<string>(record.photos)];
}
