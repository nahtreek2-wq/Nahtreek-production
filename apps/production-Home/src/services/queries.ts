import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from '@tanstack/react-query';
import {api, ApiError} from './apiClient';
import {isApiConfigured} from './config';
import {runtimeConfig} from '../config/runtime';
import NetInfo from '@react-native-community/netinfo';

// Internal builds remain useful without a deployed API: all catalogue and
// account data stays on the device and is never presented as live data.
const isReferenceMode =
  !isApiConfigured && runtimeConfig.environment === 'staging';
import {useSessionStore} from '../stores/session';
import {
  syncLocalAccountProfile,
  type ClientRegistration,
} from './localCredentials';
import {
  addOfflineMessage,
  cancelOfflineRequest,
  createOfflineConversation,
  createOfflineRequest,
  getOfflineClientProfile,
  getOfflineConversations,
  getOfflineEngineer,
  getOfflineEngineers,
  getOfflineFavorites,
  getOfflineMessages,
  getOfflineNotifications,
  getOfflineRequests,
  markAllOfflineNotificationsRead,
  markOfflineNotificationRead,
  markOfflineConversationRead,
  postOfflineReview,
  setOfflineFavorite,
  updateOfflineClientProfile,
} from '../data/offlineCatalogue';
import type {
  ConversationDto,
  ClientProfileDto,
  EngineerRequestDto,
  EngineerProfileDto,
  MessageDto,
  NotificationDto,
  PaginatedResponse,
  SearchResultDto,
  FavoriteDto,
} from '@nahtreek/types';

export const queryKeys = {
  engineers: ['engineers'] as const,
  engineer: (id: string) => ['engineer', id] as const,
  requests: ['requests'] as const,
  conversations: ['conversations'] as const,
  messages: (id: string) => ['messages', id] as const,
  notifications: ['notifications'] as const,
  favorites: ['favorites'] as const,
  search: (q: string, city?: string) => ['search', q, city ?? 'all'] as const,
};

function isRecoverableNetworkFailure(error: unknown): boolean {
  if (error instanceof ApiError) {
    return (
      error.status === 0 ||
      [408, 502, 503, 504, 520, 521, 522, 523, 524].includes(error.status)
    );
  }
  return true;
}

async function readWithOfflineFallback<T>(
  live: () => Promise<T>,
  offline: () => Promise<T>,
): Promise<T> {
  if (!isApiConfigured) {
    if (!isReferenceMode)
      throw new ApiError(
        0,
        'Service is not connected yet. Please try again later.',
      );
    return offline();
  }
  try {
    return await live();
  } catch (error) {
    if (isRecoverableNetworkFailure(error) && isReferenceMode) return offline();
    throw error;
  }
}

// Local catalogue writes are only available when no API has been configured.
// Once a live API is configured, network failures must be surfaced so the UI
// cannot present an unsent request or message as a server-side success.
async function writeWithOfflineFallback<T>(
  live: () => Promise<T>,
  offline: () => Promise<T>,
): Promise<T> {
  const epoch = useSessionStore.getState().sessionEpoch;
  if (!isReferenceMode && !useSessionStore.getState().accessToken)
    throw new ApiError(401, 'Please sign in to continue.');
  const network = await NetInfo.fetch();
  if (useSessionStore.getState().sessionEpoch !== epoch)
    throw new ApiError(401, 'Your account changed. Please try again.');
  if (
    !isReferenceMode &&
    (network.isConnected === false || network.isInternetReachable === false)
  )
    throw new ApiError(
      0,
      'You’re offline. Connect to the internet to continue.',
    );
  if (!isApiConfigured) {
    if (!isReferenceMode)
      throw new ApiError(
        0,
        'Service is not connected yet. Please try again later.',
      );
    return offline();
  }
  return live();
}

function currentOfflineUser() {
  const user = useSessionStore.getState().user;
  return user
    ? {
        id: user.id,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        email: user.email,
        address: user.address,
        homeCity: user.homeCity,
        state: user.state,
        postalCode: user.postalCode,
      }
    : null;
}

// The recovered original catalogue is a clearly labelled device-local fallback.
// It lets the Client browse and save work offline, without representing its
// availability, chat, or request updates as live server information.
function adapt<T>(
  q: {
    data: T | undefined;
    isPending: boolean;
    isError: boolean;
    error: Error | null;
    isRefetching: boolean;
    refetch: () => unknown;
  },
  fallback: T,
) {
  return {
    data: (q.data ??
      (!isReferenceMode
        ? Array.isArray(fallback)
          ? []
          : undefined
        : fallback)) as T,
    isLoading: q.isPending && !q.isError,
    isRefetching: q.isRefetching,
    isError: q.isError,
    error: q.error,
    isOffline: !isReferenceMode && (!isApiConfigured || q.isError),
    refetch: () => q.refetch(),
  };
}

async function list<T>(path: string): Promise<T[]> {
  const res = await api.get<PaginatedResponse<T> | T[]>(path);
  return Array.isArray(res) ? res : res.data;
}

export function useHomeData() {
  const engs = useQuery({
    queryKey: queryKeys.engineers,
    queryFn: () => {
      if (!isApiConfigured)
        throw new ApiError(0, 'Live professional listings are unavailable until the service connects.');
      return list<EngineerProfileDto>('/discovery/engineers');
    },
    retry: 0,
    staleTime: 60_000,
  });
  return {
    data: {engineers: (engs.data ?? []) as EngineerProfileDto[]},
    isLoading: engs.isPending && !engs.isError,
    isRefetching: engs.isRefetching,
    isError: engs.isError,
    isOffline: !isReferenceMode && (!isApiConfigured || engs.isError),
    refetch: engs.refetch,
  };
}

export function useEngineList(
  sort?: string,
  specialization?: string,
  city?: string,
  state?: string,
  coords?: {latitude: number; longitude: number},
) {
  const params: string[] = [];
  if (sort) params.push('sort=' + encodeURIComponent(sort));
  if (specialization && specialization !== 'All')
    params.push('specialization=' + encodeURIComponent(specialization));
  if (city)
    params.push(
      'city=' + encodeURIComponent(city.split(',')[0]?.trim() ?? city),
    );
  if (state) params.push('state=' + encodeURIComponent(state));
  if (coords) {
    params.push('lat=' + encodeURIComponent(coords.latitude));
    params.push('lng=' + encodeURIComponent(coords.longitude));
  }
  return usePagedList<EngineerProfileDto>(
    [
      ...queryKeys.engineers,
      sort ?? 'top',
      specialization ?? 'All',
      city ?? 'all',
      state ?? 'all',
      coords ? `${coords.latitude.toFixed(3)},${coords.longitude.toFixed(3)}` : 'no-geo',
    ],
    '/discovery/engineers?' + params.join('&'),
    () => getOfflineEngineers(city),
    Boolean(city?.trim()),
    true,
  );
}

export function useEngineerDetail(id: string) {
  const client = useQueryClient();
  const cachedEngineer = (() => {
    const find = (value: unknown): EngineerProfileDto | undefined => {
      if (Array.isArray(value)) {
        return value.find(item => item && typeof item === 'object' &&
          ((item as EngineerProfileDto).id === id || (item as EngineerProfileDto).professionalProfileId === id));
      }
      if (!value || typeof value !== 'object') return undefined;
      const record = value as {pages?: Array<{data?: EngineerProfileDto[]}>; engineers?: EngineerProfileDto[]};
      const list = record.pages?.flatMap(page => page.data ?? []) ?? record.engineers;
      return list?.find(item => item.id === id || item.professionalProfileId === id);
    };
    for (const [, value] of client.getQueriesData({queryKey: queryKeys.engineers})) {
      const match = find(value);
      if (match) return match;
    }
    for (const [, value] of client.getQueriesData({queryKey: ['search']})) {
      const match = find(value);
      if (match) return match;
    }
    return undefined;
  })();
  const q = useQuery({
    queryKey: queryKeys.engineer(id),
    initialData: cachedEngineer,
    queryFn: () =>
      readWithOfflineFallback(
        () => api.get<EngineerProfileDto>(`/discovery/engineers/${id}`),
        () => getOfflineEngineer(id),
      ),
    retry: 0,
    staleTime: cachedEngineer ? 0 : 60_000,
  });
  return adapt(q, undefined as unknown as EngineerProfileDto);
}

export function useRequestsData() {
  return usePagedList<EngineerRequestDto>(
    queryKeys.requests,
    '/engineer-requests',
    getOfflineRequests,
  );
}

export function useConversationsList() {
  return usePagedList<ConversationDto>(
    queryKeys.conversations,
    '/conversations',
    getOfflineConversations,
  );
}

export function useMessagesList(conversationId: string) {
  return useQuery<MessageDto[]>({
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    queryKey: queryKeys.messages(conversationId),
    queryFn: () =>
      readWithOfflineFallback(
        () => list<MessageDto>(`/conversations/${conversationId}/messages`),
        () => getOfflineMessages(conversationId),
      ),
    retry: 0,
    staleTime: 15_000,
  });
}

export function useSendMessage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      conversationId,
      content,
    }: {
      conversationId: string;
      content: string;
    }) =>
      writeWithOfflineFallback(
        () =>
          api.post<MessageDto>(`/conversations/${conversationId}/messages`, {
            content,
          }),
        () =>
          addOfflineMessage({
            conversationId,
            senderUserId:
              useSessionStore.getState().user?.id ?? 'offline-client',
            senderName: useSessionStore.getState().user?.fullName ?? 'You',
            content,
          }),
      ),
    onSettled: (_d, _e, v) => {
      client.invalidateQueries({
        queryKey: queryKeys.messages(v.conversationId),
      }),
        client.invalidateQueries({queryKey: queryKeys.conversations});
    },
  });
}

export function useCreateConversation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: {engineerRequestId: string; serviceRequestId?: never} | {engineerRequestId?: never; serviceRequestId: string}) => {
      if (body.serviceRequestId) return api.post<ConversationDto>('/conversations', body);
      const engineerRequestId = body.engineerRequestId;
      if (!engineerRequestId) throw new Error('Choose a request to start a conversation.');
      return writeWithOfflineFallback(
        () => api.post<ConversationDto>('/conversations', body),
        () => createOfflineConversation(engineerRequestId),
      );
    },
    onSettled: () =>
      client.invalidateQueries({queryKey: queryKeys.conversations}),
  });
}

export function useMarkConversationRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (conversationId: string) =>
      writeWithOfflineFallback(
        () => api.patch(`/conversations/${conversationId}/read`),
        () => markOfflineConversationRead(conversationId),
      ),
    onSettled: () =>
      client.invalidateQueries({queryKey: queryKeys.conversations}),
  });
}

export function useNotificationsList() {
  return usePagedList<NotificationDto>(
    queryKeys.notifications,
    '/notifications',
    getOfflineNotifications,
  );
}

export function useMarkAllNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      writeWithOfflineFallback(
        () => api.patch('/notifications/mark-all-read'),
        markAllOfflineNotificationsRead,
      ),
    onSettled: () =>
      client.invalidateQueries({queryKey: queryKeys.notifications}),
  });
}

export function useMarkNotificationRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) =>
      writeWithOfflineFallback(
        () => api.patch(`/notifications/${notificationId}/read`),
        () => markOfflineNotificationRead(notificationId),
      ),
    onSettled: () =>
      client.invalidateQueries({queryKey: queryKeys.notifications}),
  });
}

export function useFavoritesList() {
  const signedIn = useSessionStore(state => Boolean(state.accessToken));
  const q = useQuery({
    queryKey: queryKeys.favorites,
    enabled: signedIn,
    queryFn: () =>
      readWithOfflineFallback(
        () => list<FavoriteDto>('/favorites'),
        getOfflineFavorites,
      ),
    retry: 0,
    placeholderData: [] as FavoriteDto[],
    staleTime: 30_000,
  });
  return adapt(q, [] as FavoriteDto[]);
}

export function useClientProfile() {
  const signedIn = useSessionStore(state => Boolean(state.accessToken));
  return useQuery({
    queryKey: ['client-profile'] as const,
    enabled: signedIn,
    queryFn: () =>
      readWithOfflineFallback(
        () => api.get<ClientProfileDto>('/clients/me'),
        () => getOfflineClientProfile(currentOfflineUser()),
      ),
    retry: 0,
    staleTime: 60_000,
  });
}

export function useUpdateClientProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<ClientProfileDto>) =>
      writeWithOfflineFallback(
        () => api.patch<ClientProfileDto>('/clients/me', payload),
        async () => {
          const user = currentOfflineUser();
          const current = await getOfflineClientProfile(user);
          if (user?.id)
            await syncLocalAccountProfile(user.id, {...current, ...payload});
          return updateOfflineClientProfile(user, payload);
        },
      ),
    onSuccess: profile => {
      const session = useSessionStore.getState();
      if (session.user?.id !== profile.userId) return;
      client.setQueryData(['client-profile'], profile);
      session.updateUser({
        fullName: profile.fullName,
        avatarUrl: profile.avatarUrl,
        email: profile.email,
        address: profile.address,
        homeCity: profile.city,
        state: profile.state,
        postalCode: profile.postalCode,
      });
    },
  });
}

export function useToggleFavorite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      professionalId,
      isAdding,
    }: {
      professionalId: string;
      isAdding: boolean;
    }) =>
      writeWithOfflineFallback(
        () =>
          isAdding
            ? api.post('/favorites', {professionalId})
            : api.delete(`/favorites/${professionalId}`),
        () => setOfflineFavorite(professionalId, isAdding),
      ),
    onMutate: async ({professionalId, isAdding}) => {
      await client.cancelQueries({queryKey: queryKeys.favorites});
      const prev = client.getQueryData<FavoriteDto[]>(queryKeys.favorites);
      client.setQueryData<FavoriteDto[]>(
        queryKeys.favorites,
        (old: FavoriteDto[] | undefined) => {
          const cur = old ?? [];
          return isAdding
            ? [...cur, {professionalId, createdAt: new Date().toISOString()}]
            : cur.filter(
                (f: FavoriteDto) => f.professionalId !== professionalId,
              );
        },
      );
      return {prev};
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) client.setQueryData(queryKeys.favorites, ctx.prev);
    },
    onSettled: () => client.invalidateQueries({queryKey: queryKeys.favorites}),
  });
}

export function useSearch(query: string, city?: string, state?: string) {
  return useQuery({
    queryKey: [...queryKeys.search(query, city), state ?? 'all'],
    queryFn: () => {
      if (!isApiConfigured)
        throw new ApiError(0, 'Live search is unavailable until the service connects.');
      // Use the same native-safe encoding as engineer/provider discovery.
      const params = [`q=${encodeURIComponent(query)}`];
      if (city) params.push(`city=${encodeURIComponent(city.split(',')[0]?.trim() ?? city)}`);
      if (state) params.push(`state=${encodeURIComponent(state)}`);
      return api.get<SearchResultDto>(`/discovery/search?${params.join('&')}`);
    },
    enabled: query.trim().length >= 2,
    refetchOnMount: 'always',
    retry: 0,
    staleTime: 30_000,
  });
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: Parameters<
    ReturnType<typeof useSessionStore.getState>['setSession']
  >[0]['user'];
}

export function useLogin() {
  return useMutation({
    mutationFn: (payload: {
      phoneNumber?: string;
      email?: string;
      password: string;
    }) => api.post<LoginResponse>('/auth/login', payload),
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: (payload: ClientRegistration & {code: string}) =>
      api.post<LoginResponse>('/auth/register', payload),
  });
}

export function useRequestOtp() {
  return useMutation({
    mutationFn: (payload: {phoneNumber: string}) =>
      api.post<{message: string; expiresIn: number}>(
        '/auth/otp/request',
        payload,
      ),
  });
}

export function useVerifyOtp() {
  return useMutation({
    mutationFn: (payload: {
      phoneNumber: string;
      code: string;
      fullName?: string;
      city?: string;
      state?: string;
    }) =>
      api.post<LoginResponse & {isNewUser: boolean}>(
        '/auth/otp/verify',
        payload,
      ),
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: (refreshToken: string | null) =>
      refreshToken
        ? readWithOfflineFallback(
            () => api.post('/auth/logout', {refreshToken}),
            () => Promise.resolve({ok: true}),
          )
        : Promise.resolve({ok: true}),
  });
}

export function useCreateRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<EngineerRequestDto>) =>
      writeWithOfflineFallback(
        () => api.post<EngineerRequestDto>('/engineer-requests', payload),
        () => createOfflineRequest(payload),
      ),
    onSettled: () => client.invalidateQueries({queryKey: queryKeys.requests}),
  });
}

export function useCancelRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      writeWithOfflineFallback(
        () => api.patch<EngineerRequestDto>(`/engineer-requests/${id}/cancel`),
        () => cancelOfflineRequest(id),
      ),
    onSettled: () => {
      void client.invalidateQueries({queryKey: queryKeys.requests});
      void client.invalidateQueries({queryKey: ['request-detail']});
    },
  });
}

export function useRescheduleRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({id, scheduledAt}: {id: string; scheduledAt: string}) =>
      api.patch<EngineerRequestDto>(`/engineer-requests/${id}/reschedule`, {scheduledAt}),
    onSettled: () => {
      void client.invalidateQueries({queryKey: queryKeys.requests});
      void client.invalidateQueries({queryKey: ['request-detail']});
    },
  });
}

export function usePostReview() {
  return useMutation({
    mutationFn: ({
      id,
      rating,
      comment,
    }: {
      id: string;
      rating: number;
      comment: string;
    }) =>
      writeWithOfflineFallback(
        () => api.post(`/engineer-requests/${id}/reviews`, {rating, comment}),
        () =>
          postOfflineReview({
            requestId: id,
            rating,
            comment,
            reviewerName:
              useSessionStore.getState().user?.fullName ?? 'Offline client',
          }),
      ),
  });
}

export type RequestDetail = EngineerRequestDto & {
  statusHistory?: {id: string; toStatus: string; createdAt: string}[];
};
export function useRequestDetail(id: string) {
  const q = useQuery({
    queryKey: ['request-detail', id],
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    queryFn: () =>
      readWithOfflineFallback(
        () =>
          api.get<RequestDetail>(
            '/engineer-requests/' + encodeURIComponent(id),
          ),
        async () =>
          (await getOfflineRequests()).find(
            item => item.id === id,
          ) as RequestDetail,
      ),
    staleTime: 15000,
    retry: 1,
  });
  return {...q, isOffline: !isReferenceMode && (!isApiConfigured || q.isError)};
}

function usePagedList<T>(
  key: readonly string[],
  path: string,
  reference: () => Promise<T[]>,
  locationReady = true,
  liveOnly = false,
) {
  const signedIn = useSessionStore(state => Boolean(state.accessToken));
  const q = useInfiniteQuery({
    queryKey: key,
    enabled: path.startsWith('/discovery/') || signedIn,
    refetchInterval: path.startsWith('/discovery/') ? 30_000 : path === '/conversations' || path === '/engineer-requests' || path === '/notifications' ? 15000 : false,
    refetchIntervalInBackground: false,
    refetchOnMount: path.startsWith('/discovery/') ? 'always' : undefined,
    initialPageParam: 1,
    queryFn: async ({pageParam, signal}): Promise<PaginatedResponse<T>> => {
      if (!locationReady)
        return {data: [], meta: {page: 1, limit: 20, total: 0, totalPages: 0}};
      if (liveOnly && !isApiConfigured)
        throw new ApiError(0, 'Live professional listings are unavailable until the service connects.');
      if (isReferenceMode) {
        const data = await reference();
        return {
          data,
          meta: {
            page: 1,
            limit: data.length,
            total: data.length,
            totalPages: 1,
          },
        };
      }
      const separator = path.includes('?') ? '&' : '?';
      const result = await api.get<PaginatedResponse<T> | T[]>(
        path + separator + 'page=' + pageParam + '&limit=20',
        signal,
      );
      return Array.isArray(result)
        ? {
            data: result,
            meta: {
              page: 1,
              limit: result.length,
              total: result.length,
              totalPages: 1,
            },
          }
        : result;
    },
    getNextPageParam: last =>
      last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined,
    staleTime: path.startsWith('/discovery/') ? 0 : 30000,
    retry: 1,
  });
  return {
    data: (() => {
      const seen = new Set<string>();
      return (q.data?.pages.flatMap(page => page.data) ?? []).filter(item => {
        const id = (item as {id?: unknown})?.id;
        if (typeof id !== 'string') return true;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    })(),
    isLoading: q.isPending && !q.isError,
    isRefetching: q.isRefetching,
    isError: q.isError,
    error: q.error,
    isOffline: !isReferenceMode && (!isApiConfigured || q.isError),
    refetch: () => q.refetch(),
    hasNextPage: q.hasNextPage,
    isFetchingNextPage: q.isFetchingNextPage,
    loadMore: () => {
      if (q.hasNextPage && !q.isFetching) void q.fetchNextPage();
    },
  };
}
