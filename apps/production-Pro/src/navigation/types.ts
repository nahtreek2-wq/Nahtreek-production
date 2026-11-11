import type {NavigatorScreenParams} from '@react-navigation/native';

export type RootStackParamList = {
  ProfessionalType: undefined;
  AccountAccess: undefined;
  IdentitySetup: undefined;
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Requests: NavigatorScreenParams<RequestsStackParamList> | undefined;
  Schedule: undefined;
  Messages: NavigatorScreenParams<MessagesStackParamList> | undefined;
  Profile: NavigatorScreenParams<ProfileStackParamList> | undefined;
};

export type ChatThread = {conversationId: string; title: string; subtitle?: string; avatarUrl?: string; requestId?: string; requestKind?: 'engineering' | 'service'; requestStatus?: string};

export type MessagesStackParamList = {
  Conversations: undefined;
  Chat: {conversationId: string; title: string; subtitle?: string; avatarUrl?: string; requestId?: string; requestKind?: 'engineering' | 'service'; threads?: ChatThread[]};
};

export type RequestsStackParamList = {
  RequestInbox: undefined;
  RequestDetail: {id: string; kind: 'engineering' | 'service'};
  MapPreview: {latitude?: number; longitude?: number; address: string; title?: string; clientName?: string};
};

export type ProfileStackParamList = {
  ProfileOverview: undefined;
  Reviews: undefined;
  PublicProfilePreview: undefined;
  ProfessionalSetup: undefined;
  VerificationDocuments: undefined;
  Notifications: undefined;
  NotificationSettings: undefined;
  Membership: undefined;
  Dues: undefined;
  Payout: undefined;
  MyQr: undefined;
  Support: undefined;
};
