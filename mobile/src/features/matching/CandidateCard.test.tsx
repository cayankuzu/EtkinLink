import type { Candidate } from '@shared/types/domain';
import { fireEvent, render } from '@testing-library/react-native';

import { CandidateCard } from './CandidateCard';

jest.mock('@features/profile/ProfilePhotoGallery', () => ({
  ProfilePhotoGallery: () => null,
}));

const candidate: Candidate = {
  id: 'candidate-1',
  fullName: 'Ece Demir',
  username: 'ecedemir',
  age: 26,
  gender: 'woman',
  bio: 'Canlı müzik ve tasarım tutkunu.',
  city: 'İstanbul',
  joinedAt: '2026-08-01T00:00:00.000Z',
  photos: [],
  interests: [
    { id: '1', slug: 'music', label: 'Canlı müzik', sortOrder: 1 },
    { id: '2', slug: 'design', label: 'Tasarım', sortOrder: 2 },
    { id: '3', slug: 'coffee', label: 'Kahve', sortOrder: 3 },
  ],
};

describe('eşleşme aday kartı', () => {
  it('yalnızca geç ve beğen eylemlerini gösterir', async () => {
    const onPass = jest.fn();
    const onLike = jest.fn();
    const view = await render(
      <CandidateCard
        candidate={candidate}
        eventTitle="İstanbul Caz Festivali"
        onPass={onPass}
        onLike={onLike}
      />,
    );
    expect(view.getByLabelText('Geç')).toBeTruthy();
    expect(view.getByLabelText('Beğen')).toBeTruthy();
    expect(view.queryByLabelText(/geri al/i)).toBeNull();
    expect(view.queryByLabelText(/ünlem/i)).toBeNull();
    await fireEvent.press(view.getByLabelText('Geç'));
    await fireEvent.press(view.getByLabelText('Beğen'));
    expect(onPass).toHaveBeenCalledTimes(1);
    expect(onLike).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it('detay modunda eşleşme eylemlerini gizler', async () => {
    const view = await render(
      <CandidateCard
        candidate={candidate}
        eventTitle="İstanbul Caz Festivali"
        showActions={false}
      />,
    );
    expect(view.queryByLabelText('Geç')).toBeNull();
    expect(view.queryByLabelText('Beğen')).toBeNull();
    await view.unmount();
  });
});
