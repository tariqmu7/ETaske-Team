/**
 * Getting a photo or file ready for `uploadFile` (docs/DESIGN.md §6): photos are
 * shrunk in the browser so a 4 MB phone picture travels as ~300 KB.
 */

/** Same as the server's limit: 20 MB of base64 text = 15 MB of file. */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.8;

/** Formats the browser can redraw. GIF keeps its animation; HEIC usually cannot be read, so it goes as it is. */
const SHRINKABLE = /^image\/(jpeg|png|webp|bmp)$/;

export function isImageType(mimeType: string): boolean {
  return /^image\//.test(mimeType);
}

/** A photo at most 1600 px on its long side, as JPEG 0.8. Anything else (or any failure) comes back unchanged. */
export async function shrinkImage(file: File): Promise<File> {
  if (!SHRINKABLE.test(file.type)) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#fff'; // a see-through PNG would otherwise turn black as JPEG
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob || (scale === 1 && blob.size >= file.size)) return file;
    const name = file.name.replace(/\.[^.]*$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}

/** The file's bytes as base64 text (no `data:` prefix). */
export function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? '');
      resolve(s.slice(s.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}

/** "820 KB", "3.4 MB" — Latin digits in both languages. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
