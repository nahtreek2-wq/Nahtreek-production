import {useListFilters, DEFAULT_LIST_FILTERS} from '../src/stores/listFilters';

beforeEach(() => {
  useListFilters.setState({...DEFAULT_LIST_FILTERS});
});

it('starts from the documented defaults', () => {
  expect(useListFilters.getState().requestsFilter).toBe('All');
  expect(useListFilters.getState().discoveryMode).toBe('engineers');
  expect(useListFilters.getState().discoveryFilter).toBe('All');
  expect(useListFilters.getState().discoverySort).toBe('Top Rated');
});

it('keeps valid selections', () => {
  const {setRequestsFilter, setDiscoveryMode, setDiscoveryFilter, setDiscoverySort} =
    useListFilters.getState();
  setRequestsFilter('Active');
  setDiscoveryMode('services');
  setDiscoveryFilter('Geotechnical');
  setDiscoverySort('Nearest');
  const state = useListFilters.getState();
  expect(state.requestsFilter).toBe('Active');
  expect(state.discoveryMode).toBe('services');
  expect(state.discoveryFilter).toBe('Geotechnical');
  expect(state.discoverySort).toBe('Nearest');
});

it('falls back on stale values from older app versions', () => {
  const {setRequestsFilter, setDiscoveryMode, setDiscoveryFilter, setDiscoverySort} =
    useListFilters.getState();
  setRequestsFilter('Archived');
  setDiscoveryMode('plumbers');
  setDiscoveryFilter('Quantum Masonry');
  setDiscoverySort('Cheapest');
  const state = useListFilters.getState();
  expect(state.requestsFilter).toBe('All');
  expect(state.discoveryMode).toBe('engineers');
  expect(state.discoveryFilter).toBe('All');
  expect(state.discoverySort).toBe('Top Rated');
});
