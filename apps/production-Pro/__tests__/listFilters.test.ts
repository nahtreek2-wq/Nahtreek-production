import {useListFilters} from '../src/stores/listFilters';

beforeEach(() => {
  useListFilters.setState({requestsFilter: 'ALL'});
});

it('starts on ALL and keeps valid inbox tabs', () => {
  expect(useListFilters.getState().requestsFilter).toBe('ALL');
  useListFilters.getState().setRequestsFilter('NEW');
  expect(useListFilters.getState().requestsFilter).toBe('NEW');
});

it('falls back to ALL on stale values from older app versions', () => {
  useListFilters.getState().setRequestsFilter('ARCHIVED');
  expect(useListFilters.getState().requestsFilter).toBe('ALL');
});
