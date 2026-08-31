export type ProfilePhotoExtension = 'jpg' | 'png' | 'webp' | 'heic' | 'heif';

const maximumProfilePhotoBytes = 6 * 1024 * 1024;
const allowedExtensionsByMime: Record<
  string,
  readonly ProfilePhotoExtension[]
> = {
  'image/jpeg': ['jpg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/heic': ['heic'],
  'image/heif': ['heif'],
};

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function hasExpectedSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    return (
      bytes.length >= 8 &&
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (value, index) => bytes[index] === value,
      )
    );
  }
  if (mimeType === 'image/webp') {
    return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
  }
  if (mimeType === 'image/heic' || mimeType === 'image/heif') {
    if (ascii(bytes, 4, 4) !== 'ftyp') return false;
    const brand = ascii(bytes, 8, 4).toLowerCase();
    return ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand);
  }
  return false;
}

export function assertValidProfilePhoto(
  value: ArrayBuffer,
  mimeType: string,
  extension: ProfilePhotoExtension,
): void {
  const normalizedMime = mimeType.trim().toLowerCase();
  if (!allowedExtensionsByMime[normalizedMime]?.includes(extension)) {
    throw new Error('Fotoğraf MIME ve dosya uzantısı eşleşmiyor.');
  }
  if (value.byteLength < 3 || value.byteLength > maximumProfilePhotoBytes) {
    throw new Error('Fotoğraf boyutu izin verilen sınırın dışında.');
  }
  if (!hasExpectedSignature(new Uint8Array(value), normalizedMime)) {
    throw new Error('Fotoğraf içeriği bildirilen dosya türüyle eşleşmiyor.');
  }
}
