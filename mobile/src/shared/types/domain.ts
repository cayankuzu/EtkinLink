export type ProfileGender =
  | 'woman'
  | 'man'
  | 'non_binary'
  | 'prefer_not_to_say';

export type VisibilityLevel = 'everyone' | 'matches' | 'hidden';

export type Profile = {
  id: string;
  fullName: string;
  username: string;
  birthDate: string | null;
  age: number | null;
  gender: ProfileGender | null;
  genderVisibility: VisibilityLevel;
  ageVisibility: VisibilityLevel;
  bio: string;
  city: string;
  emailVerified: boolean;
  onboardingCompleted: boolean;
  matchingEnabled: boolean;
  photos: ProfilePhoto[];
  interests: Interest[];
};

export type ProfilePhoto = {
  id: string;
  userId: string;
  storagePath: string;
  position: number;
  url: string;
};

export type Interest = {
  id: string;
  slug: string;
  label: string;
  sortOrder: number;
};

export type CompatibilityEvent = {
  id: string;
  title: string;
  startAt: string;
  imageUrl: string | null;
};

export type CompatibilityDimension<T> = {
  score: number;
  commonCount: number;
  myCount: number;
  theirCount: number;
  items: T[];
};

export type CompatibilitySnapshot = {
  score: number;
  calculatedAt: string;
  interests: CompatibilityDimension<Pick<Interest, 'id' | 'label'>>;
  upcoming: CompatibilityDimension<CompatibilityEvent>;
  attended: CompatibilityDimension<CompatibilityEvent>;
};

export type MatchContext = {
  matchId: string;
  status: 'active' | 'ended';
  matchedAt: string;
  compatibility: CompatibilitySnapshot;
  firstLiker: { id: string | null; name: string | null };
  acceptedBy: { id: string | null; name: string | null };
  event: CompatibilityEvent;
};

export type EventSourceDetails = {
  status: string | null;
  attendanceMode: string | null;
  updatedAt: string | null;
  organizer: string | null;
  performers: string[];
  price: string | null;
  currency: string | null;
  ticketUrl: string | null;
  availability: string | null;
  ageRange: string | null;
  isAccessibleForFree: boolean | null;
  doorTime: string | null;
  duration: string | null;
};

export type Event = {
  id: string;
  databaseId?: string | null;
  externalId: number | null;
  title: string;
  summary: string | null;
  description: string | null;
  startAt: string;
  endAt: string | null;
  venue: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  imageUrl: string | null;
  categories: string[];
  sourceUrl: string;
  attendeeCount: number;
  attendeePhotoUrls?: string[];
  joined: boolean;
  saved: boolean;
  roomOpen?: boolean;
  sourceDetails?: EventSourceDetails;
};

export type Candidate = {
  id: string;
  fullName: string;
  username: string;
  age: number | null;
  gender: ProfileGender | null;
  bio: string;
  city: string;
  joinedAt: string;
  photos: ProfilePhoto[];
  interests: Interest[];
  compatibility?: CompatibilitySnapshot;
};

type MatchStatus = 'active' | 'ended' | 'blocked';

export type Match = {
  id: string;
  eventId: string;
  eventTitle: string;
  otherUser: Candidate;
  status: MatchStatus;
  createdAt: string;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  blockedByMe?: boolean;
};

type MessageStatus = 'sending' | 'failed' | 'sent' | 'read';

export type DirectMessage = {
  id: string;
  matchId: string;
  senderId: string;
  receiverId: string;
  body: string;
  clientMessageId: string;
  readAt: string | null;
  createdAt: string;
  status: MessageStatus;
};

export type RoomMessage = {
  id: string;
  eventId: string;
  senderId: string;
  senderName: string;
  senderPhotoUrl: string | null;
  body: string;
  clientMessageId: string;
  createdAt: string;
  status: MessageStatus;
};
