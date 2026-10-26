import type { LocalStore } from '../storage/local';
import { DEFAULT_PHOTO_OPTIONS, isPhotoOptions, photoExtension, type PhotoOptions } from '../domain/photos';

/** Optimize new photos or retain the original bytes, according to device preferences. */
export async function preparePhoto(file: File, options: PhotoOptions = DEFAULT_PHOTO_OPTIONS): Promise<{ name: string; blob: Blob }> {
  if (!isPhotoOptions(options)) throw new Error('Choose a valid longest side for photos.');
  const extension = photoExtension(file);
  if (file.size > 30 * 1024 * 1024) throw new Error('Choose a photo smaller than 30 MB.');
  if (!options.optimize) return { name: `${crypto.randomUUID()}.${extension}`, blob: file };
  let image: ImageBitmap;
  try { image = await createImageBitmap(file); }
  catch { throw new Error('This browser cannot optimize this photo. Turn off Optimize new photos to keep the original file.'); }
  try {
    const scale = Math.min(1, options.maxDimension / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare photos.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('Could not prepare this photo.')), 'image/jpeg', 0.85);
    });
    return { name: `${crypto.randomUUID()}.jpg`, blob };
  } finally { image.close(); }
}

/** Object URLs are local display handles, never stored in Markdown or cloud storage. */
export class PhotoUrls {
  private urls = new Map<string, { url: string; width?: number; height?: number }>();
  version = 0;
  constructor(private local: LocalStore) {}
  async get(name: string): Promise<{ url: string; width?: number; height?: number } | undefined> {
    const version = this.version;
    const existing = this.urls.get(name);
    if (existing) return existing;
    const photo = await this.local.photo(name);
    if (!photo) return;
    // Know the dimensions before displaying the image so decoding/lazy loading
    // cannot replace a short placeholder with a screen-height photo later.
    let width: number | undefined, height: number | undefined;
    try {
      const bitmap = await createImageBitmap(photo);
      width = bitmap.width; height = bitmap.height;
      bitmap.close();
    } catch { /* Keep an original downloadable even when this browser cannot decode it. */ }
    if (version !== this.version) return;
    // Another thumbnail may have completed the same lookup while we awaited IDB.
    const preview = this.urls.get(name) ?? { url: URL.createObjectURL(photo), width, height };
    this.urls.set(name, preview);
    return preview;
  }
  clear(): void {
    this.version++;
    this.urls.forEach(photo => URL.revokeObjectURL(photo.url));
    this.urls.clear();
  }
}
