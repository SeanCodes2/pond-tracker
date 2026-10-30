export interface ResizedImage {
  blob: Blob;
  width: number;
  height: number;
}

async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      // Honour EXIF orientation so phone photos are not sideways.
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      // fall through to <img>
    }
  }
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode image'));
    };
    img.src = url;
  });
}

/** Downscales an image so its long edge is at most maxEdge px and re-encodes as JPEG. */
export async function resizeImage(blob: Blob, maxEdge = 1200, quality = 0.8): Promise<ResizedImage> {
  if (typeof document === 'undefined') {
    return { blob, width: 0, height: 0 };
  }
  const src = await decode(blob);
  const sw = src.width;
  const sh = src.height;
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(src, 0, 0, width, height);
  if ('close' in src) src.close();

  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!out) throw new Error('Could not encode image');
  return { blob: out, width, height };
}
