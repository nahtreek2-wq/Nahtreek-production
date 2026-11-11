import {getStateFromPath} from '@react-navigation/native';
import {linking} from '../src/navigation/linking';

describe('pro deep linking config', () => {
  it('resolves nahtreek-pro://requests/:kind/:id through Main > Requests to the job', () => {
    const state = getStateFromPath('requests/engineering/job-7', linking.config);
    expect(state).toBeDefined();
    const main = state!.routes[state!.routes.length - 1];
    expect(main.name).toBe('Main');
    const tabs = (main.state?.routes ?? []) as {name: string; state?: {routes: {name: string; params?: object}[]}}[];
    const requests = tabs.find(route => route.name === 'Requests');
    expect(requests).toBeDefined();
    const detail = (requests!.state?.routes ?? []).find(route => route.name === 'RequestDetail');
    expect(detail).toBeDefined();
    expect(detail!.params).toMatchObject({kind: 'engineering', id: 'job-7'});
  });

  it('resolves service jobs with the service kind intact', () => {
    const state = getStateFromPath('requests/service/svc-3', linking.config);
    expect(state).toBeDefined();
    const main = state!.routes[state!.routes.length - 1] as {
      state?: {routes: {name: string; state?: {routes: {name: string; params?: object}[]}}[]};
    };
    const requests = (main.state?.routes ?? []).find(route => route.name === 'Requests');
    const detail = requests!.state!.routes.find(route => route.name === 'RequestDetail');
    expect(detail).toBeDefined();
    expect(detail!.params).toMatchObject({kind: 'service', id: 'svc-3'});
  });
});
