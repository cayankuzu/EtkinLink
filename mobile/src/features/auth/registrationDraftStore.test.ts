import {
  getRegistrationDraft,
  useRegistrationDraftStore,
} from './registrationDraftStore';

describe('registration draft', () => {
  beforeEach(() => {
    useRegistrationDraftStore.getState().reset();
  });

  it('collects all steps without creating an account early', () => {
    const state = useRegistrationDraftStore.getState();
    state.setCredentials(' Test@Example.com ', 'StrongPassword1');
    state.setBasics({
      fullName: 'Ece Yılmaz',
      username: 'ece_yilmaz',
      birthDate: new Date('1997-05-11T00:00:00.000Z'),
      gender: 'woman',
    });
    state.setDetails({
      city: 'İstanbul',
      bio: 'Canlı müzik ve sergi etkinliklerini keşfetmeyi seviyorum.',
      interestIds: ['one', 'two', 'three'],
      interestLabels: ['Konser', 'Sergi', 'Tasarım'],
    });

    const draft = getRegistrationDraft();
    expect(draft.email).toBe('test@example.com');
    expect(draft.basics?.username).toBe('ece_yilmaz');
    expect(draft.details?.interestIds).toHaveLength(3);
    expect(draft.submitted).toBe(false);
  });

  it('removes the password after the final submission', () => {
    const state = useRegistrationDraftStore.getState();
    state.setCredentials('test@example.com', 'StrongPassword1');
    state.markSubmitted();

    const draft = getRegistrationDraft();
    expect(draft.submitted).toBe(true);
    expect(draft.password).toBe('');
  });
});
