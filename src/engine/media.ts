// Getting pixels in and out of the browser: decoding files, resizing, and painting an Img onto a canvas.
import type { Img } from '../core/types.ts';

export type Drawable = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

export const NOT_AN_IMAGE = 'That file is not an image. Try a JPEG, PNG or WebP photo.';
export const CANNOT_OPEN = 'This browser could not open that photo. HEIC files often fail; export a JPEG instead.';

/** Read a file as a drawable, honouring the photo's EXIF rotation where the browser can. */
export async function decodeFile(file: File | null | undefined): Promise<Drawable> {
  if (!file || !file.type.startsWith('image/')) throw new Error(NOT_AN_IMAGE);
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(CANNOT_OPEN)); };
      img.src = url;
    });
  }
}

export function closeDrawable(d: Drawable | null): void {
  if (d && 'close' in d && typeof d.close === 'function') d.close();
}

/** Pixels of a drawable, scaled down so its longest edge is at most `maxEdge`. */
export function toImage(drawable: Drawable, maxEdge: number): Img {
  const w0 = drawable.width, h0 = drawable.height;
  const s = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(drawable, 0, 0, w, h);
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
}

/** Paint pixels onto a canvas, resizing the canvas to match. */
export function paint(canvas: HTMLCanvasElement, img: Img): void {
  if (canvas.width !== img.width) canvas.width = img.width;
  if (canvas.height !== img.height) canvas.height = img.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
}
