export type LegalDocumentKey =
  | 'about'
  | 'terms'
  | 'privacy'
  | 'kvkk'
  | 'community'
  | 'childSafety'
  | 'accountDeletion';

const legalBaseUrl = 'https://cayankuzu.github.io/EtkinLink_web';

export const legalDocumentUrls: Record<LegalDocumentKey, string> = {
  about: `${legalBaseUrl}/`,
  terms: `${legalBaseUrl}/legal/terms.html`,
  privacy: `${legalBaseUrl}/legal/privacy.html`,
  kvkk: `${legalBaseUrl}/legal/kvkk.html`,
  community: `${legalBaseUrl}/legal/community.html`,
  childSafety: `${legalBaseUrl}/legal/child-safety.html`,
  accountDeletion: `${legalBaseUrl}/legal/account-deletion.html`,
};
