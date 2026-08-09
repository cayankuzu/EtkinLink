export const contentLimits = {
  email: 254,
  password: 72,
  fullName: 70,
  username: 24,
  citySearch: 40,
  bio: 300,
  eventSearch: 80,
  messageSearch: 60,
  message: 700,
  reportDetails: 1500,
  ageDigits: 2,
  deleteConfirmation: 3,
} as const;

export const contentMinimums = {
  password: 10,
  fullName: 2,
  username: 3,
  city: 2,
  bio: 20,
  reportDetails: 20,
} as const;

export const paginationLimits = {
  eventFeed: 30,
  eventSearch: 20,
  rooms: 30,
  candidates: 33,
  conversations: 30,
  profileEvents: 40,
  thread: 35,
} as const;

export const outboxLimits = {
  messages: 40,
  maxAgeMs: 7 * 24 * 60 * 60_000,
} as const;
