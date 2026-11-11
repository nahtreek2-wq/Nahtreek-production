import {create} from 'zustand';
import {persist, createJSONStorage} from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Persisted list preferences: returning users land on the filters and sort
// they last used instead of re-picking them every visit. Setters validate
// against the known option lists (mirroring the screens) so a stale value
// from an older app version can never break a query — it falls back.
const REQUEST_FILTERS = ['All', 'Active', 'Completed', 'Cancelled'] as const;
const DISCOVERY_MODES = ['engineers', 'services'] as const;
const DISCOVERY_FILTERS = [
  'All',
  'Structural Design',
  'Architectural 3D',
  'Site Plan Approval',
  'Geotechnical',
  'Renovation Audit',
] as const;
const DISCOVERY_SORTS = ['Top Rated', 'Nearest', 'Available Now', 'Saved'] as const;

export const DEFAULT_LIST_FILTERS = {
  requestsFilter: 'All',
  discoveryMode: 'engineers',
  discoveryFilter: 'All',
  discoverySort: 'Top Rated',
} as const;

function valid<T extends string>(value: string, options: readonly T[], fallback: T): T {
  return (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

interface ListFilterState {
  requestsFilter: string;
  discoveryMode: 'engineers' | 'services';
  discoveryFilter: string;
  discoverySort: string;
  setRequestsFilter: (filter: string) => void;
  setDiscoveryMode: (mode: string) => void;
  setDiscoveryFilter: (filter: string) => void;
  setDiscoverySort: (sort: string) => void;
}

export const useListFilters = create<ListFilterState>()(
  persist(
    set => ({
      ...DEFAULT_LIST_FILTERS,
      setRequestsFilter: filter => set({requestsFilter: valid(filter, REQUEST_FILTERS, 'All')}),
      setDiscoveryMode: mode => set({discoveryMode: valid(mode, DISCOVERY_MODES, 'engineers')}),
      setDiscoveryFilter: filter => set({discoveryFilter: valid(filter, DISCOVERY_FILTERS, 'All')}),
      setDiscoverySort: sort => set({discoverySort: valid(sort, DISCOVERY_SORTS, 'Top Rated')}),
    }),
    {
      name: 'nahtreek-list-filters',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({
        requestsFilter: state.requestsFilter,
        discoveryMode: state.discoveryMode,
        discoveryFilter: state.discoveryFilter,
        discoverySort: state.discoverySort,
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<ListFilterState>;
        return {
          ...current,
          requestsFilter: valid(saved.requestsFilter ?? '', REQUEST_FILTERS, 'All'),
          discoveryMode: valid(saved.discoveryMode ?? '', DISCOVERY_MODES, 'engineers'),
          discoveryFilter: valid(saved.discoveryFilter ?? '', DISCOVERY_FILTERS, 'All'),
          discoverySort: valid(saved.discoverySort ?? '', DISCOVERY_SORTS, 'Top Rated'),
        };
      },
    },
  ),
);
