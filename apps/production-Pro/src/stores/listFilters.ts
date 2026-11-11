import {create} from 'zustand';
import {persist, createJSONStorage} from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Persisted jobs-inbox filter: returning pros land on the tab they last
// used. The setter validates so a stale value from an older app version
// can never break the list — it falls back to ALL.
export type ProRequestFilter = 'ALL' | 'NEW' | 'ACTIVE' | 'COMPLETED';
const FILTERS: ProRequestFilter[] = ['ALL', 'NEW', 'ACTIVE', 'COMPLETED'];

interface ListFilterState {
  requestsFilter: ProRequestFilter;
  setRequestsFilter: (filter: string) => void;
}

export const useListFilters = create<ListFilterState>()(
  persist(
    set => ({
      requestsFilter: 'ALL' as ProRequestFilter,
      setRequestsFilter: filter =>
        set({requestsFilter: (FILTERS as string[]).includes(filter) ? (filter as ProRequestFilter) : 'ALL'}),
    }),
    {
      name: 'nahtreek-pro-list-filters',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: state => ({requestsFilter: state.requestsFilter}),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<ListFilterState>;
        return {
          ...current,
          requestsFilter: (FILTERS as string[]).includes(saved.requestsFilter ?? '')
            ? (saved.requestsFilter as ProRequestFilter)
            : 'ALL',
        };
      },
    },
  ),
);
