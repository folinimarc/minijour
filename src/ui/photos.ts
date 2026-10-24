import type { LocalStore } from '../storage/local';

/** Resize camera images so a journal doesn't accumulate full camera originals. */
export async function preparePhoto(file: File): Promise<{ name: string; blob: Blob }> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > 30 * 1024 * 1024) throw new Error('Choose a photo smaller than 30 MB.');
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2400 / Math.max(image.width, image.height));
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

/** Object URLs are local display handles, never stored in Markdown or Dropbox. */
export class PhotoUrls {
  private urls = new Map<string, string>();
  version = 0;
  constructor(private local: LocalStore) {}
  async get(name: string): Promise<string | undefined> {
    const existing = this.urls.get(name);
    if (existing) return existing;
    const photo = await this.local.photo(name);
    if (!photo) return;
    // Another thumbnail may have completed the same lookup while we awaited IDB.
    const url = this.urls.get(name) ?? URL.createObjectURL(photo);
    this.urls.set(name, url);
    return url;
  }
  close(): void {
    this.urls.forEach(url => URL.revokeObjectURL(url));
    this.urls.clear();
  }
}
