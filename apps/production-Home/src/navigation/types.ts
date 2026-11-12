import type {NavigatorScreenParams} from '@react-navigation/native';

export type RootStackParamList = {
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  EngineerDiscovery: {planId?: string} | undefined;
  Search: {initialQuery?: string} | undefined;
  Services: {serviceId?: string} | undefined;
  ServiceProviders: {serviceId: string; title: string; fromAiPlan?: boolean};
  ServiceRequestDetail: {requestId: string; submitted?: boolean};
  ServiceHistory: undefined;
  ActivityHistory: undefined;
  EngineerProfile: {engineerId: string; planId?: string};
  ProviderProfile: {professionalProfileId: string};
  Scan: undefined;
  RequestDetail: {requestId: string};
  Loan: undefined;
  MapPreview: {latitude?: number; longitude?: number; address: string; requestId?: string};
  Chat: {conversationId: string; title: string; subtitle?: string; avatarUrl?: string};
  Notifications: undefined;
  Saved: undefined;
  Help: undefined;
  Settings: undefined;
  AiPlanner: {conversationId?: string} | undefined;
  Login: {mode?: 'login' | 'create'} | undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Discover: undefined;
  Requests: undefined;
  Messages: undefined;
  Profile: undefined;
};
