import {NativeModules} from 'react-native';

function setup(native: Record<string, unknown> | undefined) {
  if (native === undefined) delete (NativeModules as Record<string, unknown>).NahtreekRuntimeConfig;
  else (NativeModules as Record<string, unknown>).NahtreekRuntimeConfig = native;
  let integrity!: typeof import('../src/services/deviceIntegrity');
  let confirm!: typeof import('../src/stores/confirm');
  jest.isolateModules(() => {
    integrity = require('../src/services/deviceIntegrity');
    // The isolated service talks to an isolated store copy: assertions must
    // read this one, not the outer module-level store.
    confirm = require('../src/stores/confirm');
  });
  return {integrity, confirm};
}

afterEach(() => {
  jest.restoreAllMocks();
  delete (NativeModules as Record<string, unknown>).NahtreekRuntimeConfig;
});

it('warns once on compromised production devices', () => {
  const {integrity, confirm} = setup({environment: 'production', deviceCompromised: true});
  integrity.warnForCompromiseOnce();
  expect(confirm.useConfirmStore.getState().current).toMatchObject({title: 'Device security warning',
    confirmLabel: 'Understood', cancelLabel: null});
  expect(confirm.useConfirmStore.getState().current?.message).toMatch(/rooted or jailbroken/);
  confirm.useConfirmStore.getState().answer(true);
  integrity.warnForCompromiseOnce();
  expect(confirm.useConfirmStore.getState().current).toBeNull();
});

it.each([
  ['clean device', {environment: 'production', deviceCompromised: false}],
  ['staging runtime', {environment: 'staging', deviceCompromised: true}],
  ['development runtime', {environment: 'development', deviceCompromised: true}],
  ['missing flag', {environment: 'production'}],
])('stays silent for %s', (_label, native) => {
  const {integrity, confirm} = setup(native);
  integrity.warnForCompromiseOnce();
  expect(confirm.useConfirmStore.getState().current).toBeNull();
});

it('stays silent when the native module is unavailable', () => {
  const {integrity, confirm} = setup(undefined);
  integrity.warnForCompromiseOnce();
  expect(confirm.useConfirmStore.getState().current).toBeNull();
});
