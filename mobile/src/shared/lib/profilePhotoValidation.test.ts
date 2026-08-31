import { assertValidProfilePhoto } from './profilePhotoValidation';

describe('profil fotoğrafı içerik doğrulaması', () => {
  it('JPEG ve PNG magic-byte değerlerini kabul eder', () => {
    expect(() =>
      assertValidProfilePhoto(
        Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer,
        'image/jpeg',
        'jpg',
      ),
    ).not.toThrow();
    expect(() =>
      assertValidProfilePhoto(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
          .buffer,
        'image/png',
        'png',
      ),
    ).not.toThrow();
  });

  it('spoof edilmiş MIME/extension ve magic-byte girdilerini reddeder', () => {
    expect(() =>
      assertValidProfilePhoto(
        Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer,
        'image/png',
        'jpg',
      ),
    ).toThrow('MIME');
    expect(() =>
      assertValidProfilePhoto(
        Uint8Array.from([1, 2, 3, 4]).buffer,
        'image/jpeg',
        'jpg',
      ),
    ).toThrow('içeriği');
  });

  it('aşırı büyük gövdeyi yüklemeden önce reddeder', () => {
    expect(() =>
      assertValidProfilePhoto(
        new ArrayBuffer(6 * 1024 * 1024 + 1),
        'image/jpeg',
        'jpg',
      ),
    ).toThrow('boyutu');
  });
});
