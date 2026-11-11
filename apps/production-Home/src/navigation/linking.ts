import type {LinkingOptions} from '@react-navigation/native';
import type {RootStackParamList} from './types';

// Ratings QR links: https://<site>/p/<professionalProfileId> from any camera,
// nahtreek://p/<id> for in-app and site fallbacks.
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['nahtreek://', 'https://nahtreek-website.vercel.app'],
  config: {
    screens: {
      ProviderProfile: 'p/:professionalProfileId',
      EngineerProfile: 'e/:engineerId',
      RequestDetail: 'requests/:requestId',
      AiPlanner: 'ai',
      Scan: 'scan',
    },
  },
};
