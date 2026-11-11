import React, {Component} from 'react';
import {
  Animated as NativeAnimated,
  ImageBackground,
  Pressable,
  Text,
  StyleSheet,
  View,
} from 'react-native';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import LinearGradient from 'react-native-linear-gradient';
import {
  Colors,
  BorderRadius,
  Spacing,
  Typography,
} from '@nahtreek/design-system';
import {AppHeader, Button, EmptyState, ErrorState, Icon, ICONS, SectionHeader} from '../components/ui';
import {ProviderCardSkeleton} from '../components/SkeletonLoader';
import {SERVICE_GROUPS} from '../features/services/catalogue';
import {useServiceCategories} from '../services/platformQueries';
import {workPhotoFor} from '../assets/imagery';
import type {RootStackParamList} from '../navigation/types';
import {useScrollMotion, ScrollMotionBar} from '../components/ScrollMotionBar';
import {ClientColors} from '../design-system/tokens';

class ServicesScreenBoundary extends Component<
  {children: React.ReactNode; onBack: () => void},
  {error: Error | null; retryKey: number}
> {
  state = {error: null as Error | null, retryKey: 0};

  static getDerivedStateFromError(error: Error) {
    return {error};
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep a useful stack trace available through Android logcat for diagnosis.
    console.error('[ServicesScreen] Render failure', error, info.componentStack);
  }

  private retry = () =>
    this.setState(state => ({error: null, retryKey: state.retryKey + 1}));

  render() {
    if (this.state.error) {
      return (
        <View style={styles.root}>
          <AppHeader title="Home services" onBack={this.props.onBack} />
          <View style={styles.failure}>
            <Text style={styles.failureTitle}>This service could not open</Text>
            <Text style={styles.description}>
              Go back to the service list or try opening it again.
            </Text>
            <Pressable accessibilityRole="button" onPress={this.retry} style={styles.failureButton}>
              <Text style={styles.failureButtonText}>Try again</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={this.props.onBack} style={styles.backButton}>
              <Text style={styles.backButtonText}>Back to services</Text>
            </Pressable>
          </View>
        </View>
      );
    }
    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}

function imageFor(serviceId: string): number {
  return workPhotoFor(serviceId);
}

export function ServicesScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <ServicesScreenBoundary onBack={() => nav.goBack()}>
      <ServicesScreenContent />
    </ServicesScreenBoundary>
  );
}

function ServicesScreenContent() {
  const scrollMotion = useScrollMotion();
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Services'>>();
  const categories = useServiceCategories();
  const services = categories.data ?? [];
  const requestedServiceId = route.params?.serviceId;
  const selected = services.find(item => item.id === requestedServiceId);
  return (
    <View style={styles.root}>
      <AppHeader
        title={selected?.title ?? 'Home services'}
        onBack={() => nav.goBack()}
      />
      <ScrollMotionBar offset={scrollMotion.offset} reducedMotion={scrollMotion.reducedMotion} />
      <NativeAnimated.ScrollView contentContainerStyle={styles.body} onScroll={scrollMotion.onScroll} scrollEventThrottle={16}>
        {!selected && services.length > 0 ? (
          <View style={styles.intro}>
            <Text style={styles.eyebrow}>CARE FOR YOUR HOME</Text>
            <Text style={styles.introTitle}>What needs doing?</Text>
            <Text style={styles.description}>Explore a service, then find help near you.</Text>
          </View>
        ) : null}
        {categories.isPending ? (
          <View accessibilityLabel="Loading home services">
            <ProviderCardSkeleton />
            <ProviderCardSkeleton />
          </View>
        ) : null}
        {categories.isError ? (
          <ErrorState
            title="Could not load services"
            message="Check your connection and try again."
            actionLabel="Try again"
            onAction={() => void categories.refetch()}
          />
        ) : null}
        {!categories.isPending && !categories.isError && !services.length ? (
          <EmptyState
            title="No services listed yet"
            message="Please check back later."
          />
        ) : null}
        {!categories.isPending && !categories.isError && requestedServiceId && !selected ? (
          <EmptyState
            title="This service is no longer available"
            message="Return to the list to choose another available service."
            actionLabel="Back to services"
            onAction={() => nav.goBack()}
          />
        ) : null}
        {selected ? (
          <View style={{gap: 20}}>
            <ImageBackground
              source={imageFor(selected.id)}
              style={styles.detailHero}
              imageStyle={styles.detailHeroImage}>
              <LinearGradient
                colors={['rgba(7,31,61,0.12)', 'rgba(7,31,61,0.92)']}
                style={styles.detailOverlay}>
                <Text style={styles.detailGroup}>{selected.group}</Text>
                <Text style={styles.detailTitle}>{selected.title}</Text>
                <Text style={styles.detailDescription}>
                  {selected.description}
                </Text>
              </LinearGradient>
            </ImageBackground>
            <Button
              label="Find help near me"
              onPress={() =>
                nav.navigate('ServiceProviders', {
                  serviceId: selected.id,
                  title: selected.title,
                })
              }
            />
          </View>
        ) : (
          SERVICE_GROUPS.filter(group =>
            services.some(item => item.group === group),
          ).map(group => (
            <View key={group} style={{marginBottom: 24}}>
              <SectionHeader title={group} />
              {services
                .filter(item => item.group === group)
                .map(item => (
                  <Pressable
                    key={item.id}
                    style={({pressed}) => [styles.card, pressed && styles.cardPressed]}
                    accessibilityRole="button"
                    accessibilityLabel={item.title}
                    onPress={() => nav.push('Services', {serviceId: item.id})}>
                    <ImageBackground
                      source={imageFor(item.id)}
                      style={styles.cardImage}
                      imageStyle={styles.cardImageRadius}>
                      <LinearGradient
                        colors={['rgba(7,31,61,0)', 'rgba(7,31,61,0.62)']}
                        style={styles.cardImageOverlay}
                      />
                    </ImageBackground>
                    <View style={{flex: 1}}>
                      <Text style={styles.title}>{item.title}</Text>
                      <Text style={styles.description} numberOfLines={2}>
                        {item.description}
                      </Text>
                    </View>
                    <Icon
                      name={ICONS.chevronRight}
                      size={22}
                      color={Colors.navyMid}
                    />
                  </Pressable>
                ))}
            </View>
          ))
        )}
      </NativeAnimated.ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: ClientColors.lightBackground},
  body: {padding: 20, paddingBottom: 40},
  intro: {marginBottom: 24, gap: 8},
  eyebrow: {fontSize: 11, fontWeight: '700', letterSpacing: 1.5, color: ClientColors.iconSlate},
  introTitle: {fontSize: 28, lineHeight: 34, fontWeight: '700', color: ClientColors.primaryNavy},
  card: {
    padding: 16,
    marginBottom: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: 16,
    flexDirection: 'row',
    gap: Spacing.md,
    alignItems: 'center',
  },
  cardPressed: {opacity: 0.84, transform: [{scale: 0.985}]},
  cardImage: {
    width: 64,
    height: 72,
    overflow: 'hidden',
    backgroundColor: Colors.slate100,
  },
  cardImageRadius: {borderRadius: BorderRadius.md},
  cardImageOverlay: {flex: 1},
  title: {fontSize: 17, lineHeight: 23, fontWeight: '700', color: ClientColors.primaryNavy, marginBottom: 4},
  description: {fontSize: 14, lineHeight: 21, color: Colors.slate500},
  detailHero: {
    minHeight: 280,
    overflow: 'hidden',
    borderRadius: 16,
  },
  detailHeroImage: {borderRadius: 16},
  detailOverlay: {flex: 1, minHeight: 280, justifyContent: 'flex-end', padding: 24},
  detailGroup: {
    ...Typography.badge,
    color: Colors.white,
    letterSpacing: 1.2,
    marginBottom: Spacing.xs,
  },
  detailTitle: {...Typography.h1, color: Colors.white},
  detailDescription: {
    ...Typography.body,
    color: Colors.white,
    marginTop: Spacing.xs,
  },
  failure: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.md},
  failureTitle: {...Typography.h2, color: Colors.slate900, textAlign: 'center'},
  failureButton: {minHeight: 48, minWidth: 160, paddingHorizontal: Spacing.lg, alignItems: 'center', justifyContent: 'center', borderRadius: BorderRadius.lg, backgroundColor: Colors.navyDeep},
  failureButtonText: {...Typography.button, color: Colors.white},
  backButton: {minHeight: 44, paddingHorizontal: Spacing.md, alignItems: 'center', justifyContent: 'center'},
  backButtonText: {...Typography.button, color: Colors.navyDeep},
});
