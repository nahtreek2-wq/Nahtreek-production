import {getStateFromPath} from '@react-navigation/native';
import {linking} from '../src/navigation/linking';

describe('deep linking config', () => {
  it('resolves nahtreek://p/:id to ProviderProfile with the profile id', () => {
    const state = getStateFromPath('p/deeplink-test-1', linking.config);
    expect(state).toBeDefined();
    const route = state!.routes[state!.routes.length - 1];
    expect(route.name).toBe('ProviderProfile');
    expect(route.params).toMatchObject({professionalProfileId: 'deeplink-test-1'});
  });

  it('resolves the https site fallback to the same screen', () => {
    const state = getStateFromPath(
      'p/abc123',
      linking.config,
    );
    expect(state).toBeDefined();
    const route = state!.routes[state!.routes.length - 1];
    expect(route.name).toBe('ProviderProfile');
    expect(route.params).toMatchObject({professionalProfileId: 'abc123'});
  });

  it('resolves nahtreek://scan to the Scan screen', () => {
    const state = getStateFromPath('scan', linking.config);
    expect(state).toBeDefined();
    expect(state!.routes[state!.routes.length - 1].name).toBe('Scan');
  });
});
