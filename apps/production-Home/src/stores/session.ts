import {create} from 'zustand';
import {secureSession} from '../services/secureSession';
import {isApiConfigured} from '../services/config';
import {useCity} from './city';

interface SessionUser {
  id: string;
  fullName: string;
  phoneNumber: string;
  roles: string[];
  avatarUrl?: string;
  email?: string;
  address?: string;
  homeCity?: string;
  state?: string;
  postalCode?: string;
}

interface SessionState {
  sessionEpoch: number;
  storageError: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  needsProfileSetup: boolean;
  isHydrated: boolean;
  user: SessionUser | null;
  setSession: (tokens: {
    accessToken: string;
    refreshToken: string;
    user: SessionUser;
  }, options?: {needsProfileSetup?: boolean}) => void;
  completeProfileSetup: () => void;
  hydrateSession: () => Promise<void>;
  updateUser: (patch: Partial<SessionUser>) => void;
  clearSession: () => void;
}

type PersistedSession = {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
};

function isPersistedSession(value: unknown): value is PersistedSession {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersistedSession>;
  return Boolean(
    typeof candidate.accessToken === 'string' &&
      typeof candidate.refreshToken === 'string' &&
      candidate.user &&
      typeof candidate.user.id === 'string' &&
      typeof candidate.user.fullName === 'string' &&
      typeof candidate.user.phoneNumber === 'string' &&
      Array.isArray(candidate.user.roles),
  );
}

// Offline tokens are self-minted when no API is configured. Once the build
// talks to a server (e.g. upgraded from an unconfigured install), they must
// never be restored and sent as Bearer credentials.
function isStaleOfflineSession(session: PersistedSession): boolean {
  return isApiConfigured && (session.accessToken.startsWith('offline.') || session.refreshToken.startsWith('offline.'));
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  sessionEpoch: 0,
  storageError: null,
  accessToken: null,
  refreshToken: null,
  needsProfileSetup: false,
  isHydrated: false,
  user: null,
  setSession: ({accessToken, refreshToken, user}, options) => {
    const epoch = get().sessionEpoch + 1;
    useCity.getState().setCity(user.homeCity ?? '', user.state);
    set({accessToken, refreshToken, user, needsProfileSetup: options?.needsProfileSetup ?? false, sessionEpoch: epoch, storageError: null});
    void secureSession.write(JSON.stringify({accessToken, refreshToken, user})).catch(() => {
      if (get().sessionEpoch === epoch) set({storageError: 'Your sign-in could not be saved. You may need to sign in again after closing the app.'});
    });
  },
  hydrateSession: async () => {
    const epoch = get().sessionEpoch;
    try {
      const raw = await secureSession.read();
      if (!raw || get().sessionEpoch !== epoch) return;
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
      if (isPersistedSession(parsed) && !isStaleOfflineSession(parsed)) {
        useCity.getState().setCity(parsed.user.homeCity ?? '', parsed.user.state);
        set({
          accessToken: parsed.accessToken,
          refreshToken: parsed.refreshToken,
          user: parsed.user,
        });
      } else {
        await secureSession.clear();
      }
    } catch {
      if (get().sessionEpoch === epoch) set({storageError: 'Your saved sign-in is temporarily unavailable. Unlock your device and try again.'});
    } finally {
      set({isHydrated: true});
    }
  },
  updateUser: patch =>
    set(state => {
      const user = state.user ? {...state.user, ...patch} : state.user;
      if (state.accessToken && state.refreshToken && user) {
        void secureSession.write(JSON.stringify({accessToken: state.accessToken, refreshToken: state.refreshToken, user})).catch(() => {
          if (get().sessionEpoch === state.sessionEpoch) set({storageError: 'Your updated profile could not be saved on this device.'});
        });
      }
      return {user};
    }),
  completeProfileSetup: () => set({needsProfileSetup: false}),
  clearSession: () => {
    const epoch = get().sessionEpoch + 1;
    useCity.getState().setCity('');
    set({accessToken: null, refreshToken: null, needsProfileSetup: false, user: null, sessionEpoch: epoch, storageError: null});
    void secureSession.clear().catch(() => {
      if (get().sessionEpoch === epoch) set({storageError: 'Saved sign-in could not be removed. Unlock your device and try signing out again.'});
    });
  },
}));
