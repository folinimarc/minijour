export const PHOTO_TYPES = {
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  avif: 'image/avif', heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', bmp: 'image/bmp',
} as const;
export const PHOTO_NAME_SOURCE = `[a-f0-9-]{36}\\.(?:${Object.keys(PHOTO_TYPES).join('|')})`;
export const PHOTO_NAME = new RegExp(`^${PHOTO_NAME_SOURCE}$`);
export const PHOTO_DELETION_PATH = new RegExp(`^/deleted-photos/(${PHOTO_NAME_SOURCE})\\.json$`);

export function photoType(name: string): string {
  if (!PHOTO_NAME.test(name)) throw new Error('Invalid photo name.');
  return PHOTO_TYPES[name.slice(name.lastIndexOf('.') + 1) as keyof typeof PHOTO_TYPES];
}

/** Canonical extensions keep MIME types portable through cloud files and ZIPs. */
export function photoExtension(file: { name: string; type: string }): string {
  const aliases: Record<string, string> = {
    'image/heic-sequence': 'heic', 'image/heif-sequence': 'heif', 'image/x-ms-bmp': 'bmp',
  };
  const type = file.type.toLowerCase();
  const known = Object.entries(PHOTO_TYPES).find(([, value]) => value === type)?.[0]
    ?? (Object.hasOwn(aliases, type) ? aliases[type] : undefined);
  if (known) return known;
  if (!type || type === 'application/octet-stream') {
    const suffix = file.name.split('.').pop()!.toLowerCase();
    const extension = suffix === 'jpeg' ? 'jpg' : suffix === 'tiff' ? 'tif' : suffix;
    if (Object.hasOwn(PHOTO_TYPES, extension)) return extension;
  }
  throw new Error('Choose a JPEG, PNG, WebP, GIF, AVIF, HEIC, HEIF, TIFF, or BMP photo.');
}

export type PhotoOptions = { optimize: boolean; maxDimension: number };
export const DEFAULT_PHOTO_OPTIONS: Readonly<PhotoOptions> = { optimize: true, maxDimension: 2400 };
export const MAX_PHOTO_DIMENSION = 12000;
export function isPhotoOptions(value: unknown): value is PhotoOptions {
  const options = value as PhotoOptions | undefined;
  return !!options && typeof options.optimize === 'boolean'
    && Number.isInteger(options.maxDimension) && options.maxDimension >= 1 && options.maxDimension <= MAX_PHOTO_DIMENSION;
}

/** Be conservative: keep a photo if its path occurs anywhere in current text,
 * including reference-style links, link titles, and Markdown code examples.
 * Cleanup must not depend on the narrower syntax used by inline previews.
 */
export function referencedPhotos(texts: Iterable<string>): Set<string> {
  const names = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(new RegExp(`\\bphotos/(${PHOTO_NAME_SOURCE})(?![a-z0-9._-])`, 'gi'))) names.add(match[1].toLowerCase());
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
