import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {api, ApiError} from './apiClient';
import {isApiConfigured} from './config';
import {useSessionStore} from '../stores/session';
import {getOfflineActivity} from '../data/offlineCatalogue';

export interface ServiceCategory {
  id: string;
  slug?: string;
  title: string;
  group: string;
  description: string;
  prepare: string;
  iconName?: string;
}

export function normalizeServiceCategories(input: unknown): ServiceCategory[] {
  const records = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray((input as {data?: unknown}).data)
    ? (input as {data: unknown[]}).data
    : [];

  return records.flatMap(record => {
    if (!record || typeof record !== 'object') return [];
    const value = record as Partial<ServiceCategory>;
    const id = typeof value.slug === 'string' && value.slug.trim()
      ? value.slug.trim()
      : typeof value.id === 'string'
      ? value.id.trim()
      : '';
    if (!id || typeof value.title !== 'string' || !value.title.trim() ||
        typeof value.group !== 'string' || !value.group.trim()) return [];
    if (value.group === 'Engineering & Structural') return [];
    return [{
      ...value,
      id,
      title: value.title.trim(),
      group: value.group.trim(),
      description: typeof value.description === 'string' ? value.description : '',
      prepare: typeof value.prepare === 'string' ? value.prepare : '',
    }];
  });
}
export interface ServiceProvider {
  id: string;
  fullName: string;
  avatarUrl?: string;
  title: string;
  bio?: string;
  baseCity: string;
  isAvailable: boolean;
  yearsOfExperience: number;
  startingPricePaisa?: number;
  averageRating: number;
  totalReviewsCount: number;
  baseLatitude: number;
  baseLongitude: number;
  memberPriority?: boolean;
}
export interface ServiceRequest {
  journey?: {stage: string} | null;
  id: string;
  category: ServiceCategory;
  provider: ServiceProvider;
  description: string;
  locationAddress: string;
  latitude: number;
  longitude: number;
  status: string;
  createdAt: string;
  statusHistory: {id: string; toStatus: string; createdAt: string}[];
  reviews?: {id: string; rating: number; comment: string; createdAt: string}[];
}
const SERVICE_JOURNEY_LABELS: Record<string, string> = {
  PENDING: 'Waiting for acceptance',
  ACCEPTED: 'Visit accepted',
  EN_ROUTE: 'Professional on the way',
  ARRIVED: 'Professional arrived',
  IN_PROGRESS: 'Work in progress',
  AWAITING_CONFIRMATION: 'Work summary ready',
  COMPLETED: 'Service completed',
  CANCELLED: 'Booking cancelled',
  DECLINED: 'Professional declined',
  EXPIRED: 'Request expired',
  DISPUTED: 'Issue reported',
};
export function serviceRequestStatusLabel(
  stage?: string | null,
  fallback?: string | null,
) {
  const normalized = stage?.toUpperCase();
  if (normalized && SERVICE_JOURNEY_LABELS[normalized])
    return SERVICE_JOURNEY_LABELS[normalized];
  const legacy = fallback?.replace(/_/g, ' ').trim();
  return legacy ? legacy.charAt(0).toUpperCase() + legacy.slice(1).toLowerCase() : 'Status unavailable';
}
export interface Activity {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  createdAt: string;
  metadata?: {title?: string};
}
interface Page<T> {
  data: T[];
  meta: {page: number; totalPages: number};
}
export function useServiceCategories() {
  return useQuery({
    queryKey: ['services'],
    queryFn: async (): Promise<ServiceCategory[]> => {
      if (!isApiConfigured)
        throw new ApiError(
          0,
          'Services are unavailable until the app connects to the live service.',
        );
      const items = await api.get<unknown>('/discovery/services');
      return normalizeServiceCategories(items);
    },
    staleTime: 60_000,
    retry: 0,
  });
}
export function useServiceProviders(city: string, serviceId?: string, state?: string) {
  const normalizedCity = city.split(',')[0]?.trim() ?? '';
  // React Native 0.75's URLSearchParams.set throws on the device.
  const params: string[] = [];
  if (normalizedCity) params.push(`city=${encodeURIComponent(normalizedCity)}`);
  if (state) params.push(`state=${encodeURIComponent(state)}`);
  if (serviceId) params.push(`serviceId=${encodeURIComponent(serviceId)}`);
  const query = params.join('&');
  return useInfiniteQuery({
    queryKey: ['providers', city, state ?? 'all', serviceId ?? 'all'],
    initialPageParam: 1,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: ({pageParam}) =>
      isApiConfigured
        ? api.get<Page<ServiceProvider>>(
            `/discovery/providers?${query}${query ? '&' : ''}page=${pageParam}`,
          )
        : Promise.reject(new ApiError(0, 'Live service-provider listings are unavailable until the service connects.')),
    getNextPageParam: last =>
      last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: 0,
  });
}
export function usePlatformHistory(kind: 'service-requests' | 'history/me') {
  const userId = useSessionStore(s => s.user?.id);
  return useInfiniteQuery({
    queryKey: [kind, userId],
    refetchInterval: kind === 'service-requests' ? 15000 : 30000,
    refetchIntervalInBackground: false,
    enabled: Boolean(userId),
    initialPageParam: 1,
    queryFn: async ({pageParam}): Promise<Page<ServiceRequest | Activity>> =>
      isApiConfigured
        ? api.get<Page<ServiceRequest | Activity>>(`/${kind}?page=${pageParam}`)
        : {
            data: kind === 'history/me' ? await getOfflineActivity() : [],
            meta: {page: 1, totalPages: 0},
          },
    getNextPageParam: last =>
      last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined,
    retry: 0,
  });
}
export function useServiceRequest(id: string) {
  const userId = useSessionStore(s => s.user?.id);
  return useQuery({
    queryKey: ['service-request', userId, id],
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
    enabled: Boolean(userId && isApiConfigured),
    queryFn: () =>
      api.get<ServiceRequest>(`/service-requests/${encodeURIComponent(id)}`),
    retry: 0,
  });
}
export function useSendServiceRequest() {
  const client = useQueryClient();
  const userId = useSessionStore(s => s.user?.id);
  return useMutation({
    mutationFn: (payload: {
      professionalProfileId: string;
      serviceId: string;
      description: string;
      locationAddress: string;
      latitude: number;
      longitude: number;
    }) => {
      if (!userId || useSessionStore.getState().user?.id !== userId)
        throw new ApiError(401, 'Please sign in again.');
      if (!isApiConfigured)
        throw new ApiError(
          0,
          'Booking will be available when the service is connected.',
        );
      return api.post<ServiceRequest>('/service-requests', payload);
    },
    onSuccess: () => {
      void client.invalidateQueries({queryKey: ['service-requests']});
      void client.invalidateQueries({queryKey: ['history/me']});
    },
  });
}
export function useCancelServiceRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.patch<ServiceRequest>(
        `/service-requests/${encodeURIComponent(id)}/status`,
        {status: 'CANCELLED'},
      ),
    onSuccess: () => {
      void client.invalidateQueries({queryKey: ['service-request']});
      void client.invalidateQueries({queryKey: ['service-requests']});
      void client.invalidateQueries({queryKey: ['history/me']});
    },
  });
}
