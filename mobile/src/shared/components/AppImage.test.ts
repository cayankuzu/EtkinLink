import { stableImageCacheKey } from './AppImage';

describe('AppImage cache anahtarı', () => {
  it('dönen imzalı URL parametrelerinden etkilenmez', () => {
    expect(
      stableImageCacheKey(
        'https://project.supabase.co/storage/v1/object/sign/profile/a.jpg?token=one',
      ),
    ).toBe('https://project.supabase.co/storage/v1/object/sign/profile/a.jpg');
  });
});
