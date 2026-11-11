import React, {useEffect, useState} from 'react';
import {
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  Colors,
  BorderRadius,
  IndiaLocale,
  Spacing,
  Typography,
} from '@nahtreek/design-system';
import {ClientColors} from '../design-system/tokens';
import {
  AppHeader,
  EmptyState,
  ErrorState,
  Icon,
  ICONS,
  OfflineBanner,
} from '../components/ui';
import {ProfessionalCard} from '../components/shared/ProfessionalCard';
import {useSearch} from '../services/queries';
import {isApiConfigured} from '../services/config';
import {useDebounce} from '../hooks/useDebounce';
import {portraitFor} from '../assets/imagery';
import type {RootStackParamList} from '../navigation/types';
import type {EngineerProfileDto} from '@nahtreek/types';
import {useCity} from '../stores/city';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type SearchRoute = RouteProp<RootStackParamList, 'Search'>;

const RECENT_SEARCHES_KEY = '@nahtreek/client/recent-searches/v1';
const SUGGESTIONS = [
  {label: 'Civil engineers', query: 'civil engineer'},
  {label: 'Structural design', query: 'structural design'},
  {label: 'Architectural 3D', query: 'architectural 3d'},
  {label: 'Site plan approval', query: 'site plan approval'},
  {label: 'Coimbatore', query: 'coimbatore'},
];

export function SearchScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<SearchRoute>();
  const city = useCity(state => state.city);
  const selectedState = useCity(state => state.state);
  const [value, setValue] = useState(route.params?.initialQuery ?? '');
  const [recent, setRecent] = useState<string[]>([]);
  const debouncedQuery = useDebounce(value.trim(), 320);
  const search = useSearch(debouncedQuery, city, selectedState);
  const results = search.data?.engineers ?? [];
  const hasQuery = debouncedQuery.length >= 2;

  useEffect(() => {
    AsyncStorage.getItem(RECENT_SEARCHES_KEY)
      .then(raw => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed))
            setRecent(
              parsed.filter(item => typeof item === 'string').slice(0, 6),
            );
        } catch {
          // A malformed history should never block search.
        }
      })
      .catch(() => undefined);
  }, []);

  const remember = async (term = value) => {
    const normalized = term.trim();
    if (normalized.length < 2) return;
    const next = [
      normalized,
      ...recent.filter(item => item.toLowerCase() !== normalized.toLowerCase()),
    ].slice(0, 6);
    setRecent(next);
    await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)).catch(
      () => undefined,
    );
  };

  const submit = () => {
    Keyboard.dismiss();
    void remember();
  };

  const selectTerm = (term: string) => {
    setValue(term);
    void remember(term);
  };

  const clearHistory = () => {
    setRecent([]);
    void AsyncStorage.removeItem(RECENT_SEARCHES_KEY).catch(() => undefined);
  };

  const renderResult = ({item}: {item: EngineerProfileDto}) => (
    <ProfessionalCard
      name={item.fullName}
      avatarUrl={item.avatarUrl}
      avatarSource={item.avatarUrl ? undefined : portraitFor(item.id)}
      sub={`${item.specializations.join(' · ')} · ${item.baseCity}`}
      rating={item.averageRating}
      reviews={item.totalReviewsCount}
      verified={item.verificationStatus === 'VERIFIED'}
      priceLabel={
        item.consultationFee === undefined
          ? 'On request'
          : IndiaLocale.formatCurrency(item.consultationFee)
      }
      onPress={() =>
        navigation.navigate('EngineerProfile', {engineerId: item.id})
      }
    />
  );

  return (
    <View style={styles.container}>
      <AppHeader
        title="Search professionals"
        subtitle={`Showing results in ${city.split(',')[0]}`}
        onBack={() => navigation.goBack()}>
        <View style={styles.searchBox}>
          <Icon name={ICONS.search} size={21} color={Colors.slate400} />
          <TextInput
            autoFocus
            value={value}
            onChangeText={setValue}
            onSubmitEditing={submit}
            placeholder="Name, service, specialization or city"
            placeholderTextColor={Colors.slate500}
            returnKeyType="search"
            style={styles.input}
            accessibilityLabel="Search engineers, services, specializations, or cities"
          />
          {value.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setValue('')}
              style={styles.clearButton}>
              <Icon name={ICONS.close} size={18} color={Colors.slate500} />
            </Pressable>
          ) : null}
        </View>
      </AppHeader>

      <OfflineBanner
        force={!isApiConfigured || search.isError}
        onRetry={search.refetch}
        retrying={search.isFetching}
      />

      {hasQuery ? (
        search.isError && !results.length ? (
          <ErrorState
            icon={ICONS.search}
            title="Search is unavailable"
            message="We couldn’t refresh professionals right now. Try again or browse the saved catalogue."
            onAction={search.refetch}
          />
        ) : search.isFetching && !results.length ? (
          <View style={styles.loading}>
            <Text style={styles.loadingText}>
              Finding the right professionals…
            </Text>
          </View>
        ) : results.length ? (
          <FlatList
            data={results}
            keyExtractor={item => item.id}
            renderItem={renderResult}
            contentContainerStyle={styles.results}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <Text style={styles.resultHeading}>
                {results.length} professional{results.length === 1 ? '' : 's'}{' '}
                found
              </Text>
            }
            showsVerticalScrollIndicator={false}
          />
        ) : (
          <EmptyState
            icon={ICONS.search}
            title="No professionals found"
            message={`Try a broader search than “${debouncedQuery}”, or choose one of the popular searches below.`}
            actionLabel="Browse all engineers"
            onAction={() => navigation.navigate('EngineerDiscovery')}
          />
        )
      ) : (
        <FlatList
          data={[]}
          renderItem={() => null}
          contentContainerStyle={styles.discovery}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <>
              {recent.length ? (
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>Recent searches</Text>
                    <Pressable
                      onPress={clearHistory}
                      accessibilityRole="button">
                      <Text style={styles.clearHistory}>Clear</Text>
                    </Pressable>
                  </View>
                  <View style={styles.termList}>
                    {recent.map(term => (
                      <Pressable
                        key={term}
                        onPress={() => selectTerm(term)}
                        style={styles.termRow}
                        accessibilityRole="button"
                        accessibilityLabel={`Search again for ${term}`}>
                        <Icon
                          name={ICONS.clock}
                          size={17}
                          color={Colors.slate400}
                        />
                        <Text style={styles.termLabel}>{term}</Text>
                        <Icon
                          name={ICONS.chevronRight}
                          size={16}
                          color={Colors.slate300}
                        />
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Popular searches</Text>
                <View style={styles.suggestionGrid}>
                  {SUGGESTIONS.map(item => (
                    <Pressable
                      key={item.query}
                      onPress={() => selectTerm(item.query)}
                      style={styles.suggestion}
                      accessibilityRole="button"
                      accessibilityLabel={`Search for ${item.query}`}>
                      <Icon
                        name={ICONS.search}
                        size={16}
                        color={Colors.navyDeep}
                      />
                      <Text style={styles.suggestionLabel}>{item.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={styles.helperCard}>
                <View style={styles.helperIcon}>
                  <Icon
                    name={ICONS.engineers}
                    size={20}
                    color={ClientColors.accentIcon}
                  />
                </View>
                <View style={styles.helperCopy}>
                  <Text style={styles.helperTitle}>
                    Not sure what to search?
                  </Text>
                  <Text style={styles.helperText}>
                    Browse verified civil engineers and compare their expertise,
                    availability, and consultation fee.
                  </Text>
                </View>
              </View>
            </>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: Colors.offWhite},
  searchBox: {
    height: 48,
    marginTop: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.white,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  input: {
    flex: 1,
    color: Colors.slate900,
    ...Typography.body,
    paddingVertical: 0,
  },
  clearButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  results: {padding: Spacing.lg, paddingBottom: Spacing.xxl},
  resultHeading: {
    ...Typography.caption,
    color: Colors.slate500,
    marginBottom: Spacing.md,
  },
  loading: {padding: Spacing.xl, alignItems: 'center'},
  loadingText: {...Typography.body, color: Colors.slate600},
  discovery: {padding: Spacing.lg, paddingBottom: Spacing.xxl},
  section: {marginBottom: Spacing.xl},
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  sectionTitle: {...Typography.h3, color: Colors.slate900},
  clearHistory: {...Typography.caption, color: Colors.info, fontWeight: '700'},
  termList: {
    backgroundColor: Colors.white,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.slate200,
    overflow: 'hidden',
  },
  termRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.slate100,
  },
  termLabel: {...Typography.body, color: Colors.slate700, flex: 1},
  suggestionGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm},
  suggestion: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.slate200,
    backgroundColor: Colors.white,
    paddingHorizontal: Spacing.md,
  },
  suggestionLabel: {...Typography.caption, color: Colors.slate700},
  helperCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    backgroundColor: Colors.navyDeep,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
  },
  helperIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  helperCopy: {flex: 1},
  helperTitle: {...Typography.subtitle, fontWeight: '700', color: Colors.white},
  helperText: {
    ...Typography.caption,
    color: Colors.slate300,
    marginTop: 3,
    lineHeight: 18,
  },
});
