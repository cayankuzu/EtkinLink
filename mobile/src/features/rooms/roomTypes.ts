export type RoomState = 'locked' | 'active' | 'postEvent' | 'archived';

export type RoomSummary = {
  eventId: string;
  title: string;
  startAt: string;
  endAt: string | null;
  imageUrl: string | null;
  city: string | null;
  venue: string | null;
  joinedAt: string;
  matchingEnabled: boolean;
  roomOpen: boolean;
  unreadCount: number;
  lastMessage: string | null;
  lastMessageIsMine: boolean;
  lastMessageSenderName: string | null;
  lastMessageAt: string | null;
  state: RoomState;
};

export type RoomCursor = { joinedAt: string; eventId: string };
export type RoomPage = { items: RoomSummary[]; nextCursor: RoomCursor | null };
