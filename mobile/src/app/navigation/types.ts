import type { NavigatorScreenParams } from '@react-navigation/native';

export type AuthStackParamList = {
  Welcome: undefined;
  SignIn: undefined;
  SignUp: undefined;
  SignUpProfile: undefined;
  SignUpInterests: undefined;
  SignUpPhotos: undefined;
  SignUpReview: undefined;
  EmailSent: { email: string };
  ForgotPassword: undefined;
  ResetEmailSent: { email: string };
  NewPassword: undefined;
};

export type DiscoverStackParamList = {
  Discover: undefined;
  CityPicker: undefined;
  EventSearch: undefined;
  EventFilters: undefined;
  EventDetail: { eventId: string };
  SavedEvents: undefined;
};

export type RoomsStackParamList = {
  Rooms: undefined;
  RoomDetail: { eventId: string };
  RoomParticipants: { eventId: string };
  MatchHub: { eventId: string };
  MatchProfileEdit: { eventId: string };
  MatchCards: { eventId: string };
  MatchFilters: { eventId: string };
  EventDetail: { eventId: string };
};

export type MatchesStackParamList = {
  Matches: { section?: 'outgoing' | 'incoming' } | undefined;
};

export type MessagesStackParamList = {
  Messages: undefined;
  DirectChat: { matchId: string };
  ChatSettings: { matchId: string };
  EventDetail: { eventId: string };
  PublicProfile: { userId: string };
};

export type ProfileStackParamList = {
  Profile: undefined;
  EditProfile: undefined;
  EditPhotos: undefined;
  EditInterests: undefined;
  ProfileVisibility: undefined;
  MatchFilters: undefined;
  ChangePassword: undefined;
  Settings: undefined;
  AboutLegal: undefined;
  BlockedUsers: undefined;
  PublicProfile: { userId: string };
  EventDetail: { eventId: string };
};

export type MainTabParamList = {
  DiscoverTab: NavigatorScreenParams<DiscoverStackParamList>;
  RoomsTab: NavigatorScreenParams<RoomsStackParamList>;
  MatchesTab: NavigatorScreenParams<MatchesStackParamList>;
  MessagesTab: NavigatorScreenParams<MessagesStackParamList>;
  ProfileTab: NavigatorScreenParams<ProfileStackParamList>;
};
