import {create} from 'zustand';
import {secureSession} from '../services/secureSession';
import {isApiConfigured} from '../config/runtime';

export type ProfessionalUser = {
  id: string;
  fullName: string;
  phoneNumber: string;
  email?: string;
  roles: string[];
  avatarUrl?: string;
  city?: string;
  state?: string;
  verificationStatus?: string;
  needsProfessionalProfile?: boolean;
};

type SessionPayload = {accessToken: string; refreshToken: string; user: ProfessionalUser};
type SessionState = {
  sessionEpoch: number;
  accessToken: string | null;
  refreshToken: string | null;
  user: ProfessionalUser | null;
  hydrated: boolean;
  storageError: string | null;
  setSession: (payload: SessionPayload) => void;
  updateUser: (patch: Partial<ProfessionalUser>) => void;
  hydrate: () => Promise<void>;
  clear: () => void;
};

function valid(value: unknown): value is SessionPayload {
  if (!value || typeof value !== 'object') {return false;}
  const data = value as Partial<SessionPayload>;
  return Boolean(
    data.accessToken &&
      data.refreshToken &&
      data.user?.id &&
      Array.isArray(data.user.roles) &&
      data.user.roles.some(role => role === 'ENGINEER' || role === 'SERVICE_PROVIDER'),
  );
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessionEpoch: 0,
  accessToken: null,
  refreshToken: null,
  user: null,
  hydrated: false,
  storageError: null,
  setSession: payload => {
    set({...payload, storageError: null, sessionEpoch: get().sessionEpoch + 1});
    secureSession.write(JSON.stringify(payload)).catch(() =>
      set({storageError: 'Your sign-in could not be saved securely on this device.'}),
    );
  },
  updateUser: patch => {
    const current = get();
    if (!current.user) {return;}
    const user = {...current.user, ...patch};
    set({user});
    if (current.accessToken && current.refreshToken) {
      secureSession
        .write(JSON.stringify({accessToken: current.accessToken, refreshToken: current.refreshToken, user}))
        .catch(() => set({storageError: 'Your profile changes could not be saved securely.'}));
    }
  },
  hydrate: async () => {
    const epoch = get().sessionEpoch;
    try {
      const raw = await secureSession.read();
      if (get().sessionEpoch !== epoch) return;
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (valid(parsed) && !(isApiConfigured && (parsed.accessToken.startsWith('offline.') || parsed.refreshToken.startsWith('offline.')))) {set(parsed);}
        else {await secureSession.clear();}
      }
    } catch {
      set({storageError: 'Your saved sign-in could not be restored.'});
    } finally {
      set({hydrated: true});
    }
  },
  clear: () => {
    set({accessToken: null, refreshToken: null, user: null, storageError: null, sessionEpoch: get().sessionEpoch + 1});
    secureSession.clear().catch(() => undefined);
  },
}));
