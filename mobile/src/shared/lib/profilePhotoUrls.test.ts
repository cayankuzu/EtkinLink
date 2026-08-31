const mockCreateSignedUrls = jest.fn();

jest.mock('./supabase', () => ({
  supabase: {
    storage: {
      from: jest.fn(() => ({ createSignedUrls: mockCreateSignedUrls })),
    },
  },
}));

import { getSignedProfilePhotoUrls } from './profilePhotoUrls';

describe('private profile photo signed URLs', () => {
  it('paths are deduplicated and bearer URLs expire in five minutes', async () => {
    mockCreateSignedUrls.mockResolvedValue({
      data: [
        {
          path: 'user/photo.jpg',
          signedUrl: 'https://storage.example/sign/photo.jpg?token=secret',
        },
      ],
      error: null,
    });

    await expect(
      getSignedProfilePhotoUrls(['user/photo.jpg', 'user/photo.jpg']),
    ).resolves.toEqual(
      new Map([
        [
          'user/photo.jpg',
          'https://storage.example/sign/photo.jpg?token=secret',
        ],
      ]),
    );
    expect(mockCreateSignedUrls).toHaveBeenCalledWith(['user/photo.jpg'], 300);
  });
});
