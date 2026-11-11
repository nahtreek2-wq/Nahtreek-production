import type {LinkingOptions} from '@react-navigation/native';
import type {RootStackParamList} from './types';

// Pro deep links (job links from notifications, SMS and support threads).
// nahtreek-pro://requests/<kind>/<id> opens the job detail wherever the
// pro is in the app. Chat is intentionally NOT linked: its screen needs
// live thread context that a bare URL cannot supply — push taps navigate
// in-app with the full payload instead.
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['nahtreek-pro://'],
  config: {
    screens: {
      Main: {
        screens: {
          Requests: {
            screens: {
              RequestDetail: 'requests/:kind/:id',
            },
          },
        },
      },
    },
  },
};
