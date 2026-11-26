// File-type detection and upload validation.
//
// We never trust the file extension or the browser-supplied MIME type: the first bytes of the
// file ("magic numbers") decide what it really is, and that detected type is what we store.
// SVG is deliberately unsupported because SVG files can contain scripts.

export const ACCEPTED_TYPES = {
  'application/pdf': { kind: 'pdf', ext: 'pdf', label: 'PDF' },
  'image/jpeg': { kind: 'image', ext: 'jpg', label: 'JPG' },
  'image/png': { kind: 'image', ext: 'png', label: 'PNG' },
  'image/webp': { kind: 'image', ext: 'webp', label: 'WebP' },
  'image/gif': { kind: 'image', ext: 'gif', label: 'GIF' },
  'image/avif': { kind: 'image', ext: 'avif', label: 'AVIF' },
  'image/bmp': { kind: 'image', ext: 'bmp', label: 'BMP' },
};

export const ACCEPT_ATTRIBUTE = [
  ...Object.keys(ACCEPTED_TYPES),
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp',
].join(',');

export const SUPPORTED_LABEL = 'PDF, JPG, PNG, WebP, GIF, AVIF or BMP';

export const HEADER_BYTES = 1024;

const ascii = (bytes, start, end) => String.fromCharCode(...bytes.slice(start, end));

/** Returns the real MIME type from the leading bytes, or null if it isn't a supported type. */
export function sniffMime(bytes) {
  if (!bytes || bytes.length < 4) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  const head6 = ascii(bytes, 0, 6);
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  if (bytes[0] === 0x42 && bytes[1] === 0x4d && bytes.length >= 10 && bytes[6] === 0 && bytes[7] === 0 && bytes[8] === 0 && bytes[9] === 0) {
    return 'image/bmp';
  }
  // PDF readers accept the "%PDF-" marker anywhere in the first 1024 bytes.
  const window = ascii(bytes, 0, Math.min(bytes.length, HEADER_BYTES));
  if (window.includes('%PDF-')) return 'application/pdf';
  return null;
}

export const extForMime = (mime) => ACCEPTED_TYPES[mime]?.ext ?? null;
export const kindForMime = (mime) => ACCEPTED_TYPES[mime]?.kind ?? null;

/**
 * Validates a File/Blob: non-empty, within the size limit, and a really-supported type.
 * Resolves to { ok:true, mime, kind } or { ok:false, error }.
 */
export async function inspectFile(file, maxBytes) {
  if (!file || typeof file.size !== 'number') return { ok: false, error: 'No file was selected.' };
  if (file.size === 0) return { ok: false, error: 'That file is empty.' };
  if (file.size > maxBytes) {
    const mb = (n) => (n / (1024 * 1024)).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1);
    return { ok: false, error: `That file is ${mb(file.size)} MB — the limit is ${mb(maxBytes)} MB.` };
  }
  let header;
  try {
    header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  } catch {
    return { ok: false, error: 'We couldn’t read that file. Please try again.' };
  }
  const mime = sniffMime(header);
  if (!mime) return { ok: false, error: `That file type isn’t supported. Please upload a ${SUPPORTED_LABEL}.` };
  return { ok: true, mime, kind: kindForMime(mime) };
}
