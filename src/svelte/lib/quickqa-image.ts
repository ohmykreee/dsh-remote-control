/**
 * One-image attachment helpers for Quick Q&A.
 *
 * The clipboard and the file picker both produce a browser Blob; the same
 * helpers normalize its media type and stage it on the Host. Nothing here
 * decodes the image, so the preview can stay a cheap object URL.
 */

export const QUICKQA_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export type QuickQaImageMediaType = (typeof QUICKQA_IMAGE_TYPES)[number];

const EXTENSION_TYPES: Record<string, QuickQaImageMediaType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** Accept a MIME type or a filename and return one of the supported images. */
export function quickQaImageMediaType(value: unknown): QuickQaImageMediaType | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!text) return null;
  const direct = text.split(';')[0].trim();
  if ((QUICKQA_IMAGE_TYPES as readonly string[]).includes(direct)) {
    return direct as QuickQaImageMediaType;
  }
  const extension = /\.([a-z0-9]+)$/u.exec(direct)?.[1];
  return extension ? EXTENSION_TYPES[extension] ?? null : null;
}

export interface QuickQaPickedImage {
  blob: Blob;
  mediaType: QuickQaImageMediaType;
}

/** Read the last image currently on the user's clipboard. */
export async function readClipboardImage(): Promise<QuickQaPickedImage | null> {
  const clipboard = navigator.clipboard as Clipboard | undefined;
  if (!clipboard || typeof clipboard.read !== 'function') {
    throw new Error('clipboard-unsupported');
  }
  const items = await clipboard.read();
  let picked: QuickQaPickedImage | null = null;
  for (const item of items) {
    for (const type of item.types) {
      const mediaType = quickQaImageMediaType(type);
      if (!mediaType) continue;
      const blob = await item.getType(type);
      picked = { blob, mediaType };
    }
  }
  return picked;
}

/** Read one file chosen from the media picker. */
export function pickedFileImage(file: File | null | undefined): QuickQaPickedImage | null {
  if (!file) return null;
  const mediaType = quickQaImageMediaType(file.type) ?? quickQaImageMediaType(file.name);
  return mediaType ? { blob: file, mediaType } : null;
}

/** Stage one image on the Host and return the id the next question claims. */
export async function uploadQuickQaImage(image: QuickQaPickedImage): Promise<string> {
  const response = await fetch('/api/quickqa/attachment', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': image.mediaType },
    body: image.blob,
  });
  const payload: unknown = await response.json().catch(() => null);
  const record = typeof payload === 'object' && payload !== null
    ? payload as Record<string, unknown>
    : {};
  if (!response.ok) {
    throw new Error(typeof record.error === 'string' ? record.error : `HTTP ${response.status}`);
  }
  const id = typeof record.id === 'string' ? record.id : '';
  if (!id) throw new Error('invalid upload response');
  return id;
}
