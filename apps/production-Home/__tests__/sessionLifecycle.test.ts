jest.mock('../src/services/secureSession', () => ({secureSession: {
  read: jest.fn(), write: jest.fn().mockResolvedValue(undefined), clear: jest.fn().mockResolvedValue(undefined),
}}));
jest.mock('../src/services/config', () => ({isApiConfigured: true, API_BASE: 'https://test/api/v1', API_BASES: ['https://test/api/v1']}));
import {secureSession} from '../src/services/secureSession';
import {useSessionStore} from '../src/stores/session';
import {useCity} from '../src/stores/city';
const session = {accessToken: 'access', refreshToken: 'refresh', user: {id: 'client-1', fullName: 'Client', phoneNumber: '9000000000', roles: ['CLIENT']}};
beforeEach(() => {
  jest.clearAllMocks();
  useCity.setState({city: ''});
  useSessionStore.setState({accessToken: null, refreshToken: null, user: null, isHydrated: false, sessionEpoch: 0, storageError: null});
});
it('replaces a previous account city immediately on sign-in and clears it on sign-out', () => {
  useCity.getState().setCity('Patna');
  useSessionStore.getState().setSession({...session, user: {...session.user, homeCity: 'Coimbatore'}});
  expect(useCity.getState().city).toBe('Coimbatore');
  useSessionStore.getState().clearSession();
  expect(useCity.getState().city).toBe('');
});
it('does not delete a session because protected storage is temporarily unavailable', async () => {
  (secureSession.read as jest.Mock).mockRejectedValueOnce(new Error('Locked'));
  await useSessionStore.getState().hydrateSession();
  expect(secureSession.clear).not.toHaveBeenCalled();
  expect(useSessionStore.getState().storageError).toBeTruthy();
  expect(useSessionStore.getState().isHydrated).toBe(true);
});
it('does not resurrect a session when logout happens during hydration', async () => {
  let resolve!: (value: string) => void;
  (secureSession.read as jest.Mock).mockImplementationOnce(() => new Promise<string>(done => {resolve = done;}));
  const restoring = useSessionStore.getState().hydrateSession();
  useSessionStore.getState().clearSession();
  resolve(JSON.stringify(session));
  await restoring;
  expect(useSessionStore.getState().accessToken).toBeNull();
});
it('removes malformed session data', async () => {
  (secureSession.read as jest.Mock).mockResolvedValueOnce('{bad json');
  await useSessionStore.getState().hydrateSession();
  expect(secureSession.clear).toHaveBeenCalledTimes(1);
});
it('drops self-minted offline tokens once the app talks to a server', async () => {
  (secureSession.read as jest.Mock).mockResolvedValueOnce(JSON.stringify({...session, accessToken: 'offline.%2B919000000000', refreshToken: 'offline.%2B919000000000'}));
  await useSessionStore.getState().hydrateSession();
  expect(secureSession.clear).toHaveBeenCalledTimes(1);
  expect(useSessionStore.getState().accessToken).toBeNull();
});
it('reports failed session persistence', async () => {
  (secureSession.write as jest.Mock).mockRejectedValueOnce(new Error('Disk full'));
  useSessionStore.getState().setSession(session);
  await Promise.resolve();
  expect(useSessionStore.getState().storageError).toContain('could not be saved');
});
