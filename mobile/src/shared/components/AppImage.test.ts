import { Image as ExpoImage } from 'expo-image';

import { appImageCacheConfiguration, prefetchAppImages } from './AppImage';

const signedProfilePhotoUrl =
  'https://project.supabase.co/storage/v1/object/sign/profile-photos/user/a.jpg?token=one';
const publicEventImageUrl =
  'https://cdn.example.com/events/concert.jpg?width=800';

describe('AppImage cache privacy', () => {
  it('never assigns signed profile photos a disk policy or shared cache key', () => {
    expect(appImageCacheConfiguration(signedProfilePhotoUrl)).toEqual({
      cachePolicy: 'memory',
      recyclingKey: signedProfilePhotoUrl,
    });
  });

  it('preserves disk caching for public event images', () => {
    expect(appImageCacheConfiguration(publicEventImageUrl)).toEqual({
      cachePolicy: 'memory-disk',
      cacheKey: 'https://cdn.example.com/events/concert.jpg',
      recyclingKey: 'https://cdn.example.com/events/concert.jpg',
    });
  });

  it('prefetches private and public images with separate policies', async () => {
    const prefetch = jest.mocked(ExpoImage.prefetch);
    prefetch.mockClear();

    await prefetchAppImages([signedProfilePhotoUrl, publicEventImageUrl]);

    expect(prefetch).toHaveBeenCalledWith([signedProfilePhotoUrl], {
      cachePolicy: 'memory',
    });
    expect(prefetch).toHaveBeenCalledWith([publicEventImageUrl], {
      cachePolicy: 'memory-disk',
    });
  });
});
