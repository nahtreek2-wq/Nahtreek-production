import React, {useState} from 'react';
import {NavigationContainer, useNavigation} from '@react-navigation/native';
import {View, Text, StyleSheet, useWindowDimensions} from 'react-native';
import {AppHeader, Button} from '../components/ui';
import {linking} from './linking';
import {ServicesScreen} from '../screens/ServicesScreen';
import {ServiceProvidersScreen} from '../screens/ServiceProvidersScreen';
import {
  PlatformHistoryScreen,
  ActivityHistoryScreen,
} from '../screens/PlatformHistoryScreen';
import {ServiceRequestDetailScreen} from '../screens/ServiceRequestDetailScreen';
import {MapPreviewScreen} from '../screens/MapPreviewScreen';
import type {
  NativeStackNavigationProp,
  NativeStackScreenProps,
} from '@react-navigation/native-stack';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Colors} from '@nahtreek/design-system';
import {ClientColors} from '../design-system/tokens';
import {NavigationIcon, NavigationIconName} from '../../../../packages/mobile-ui/NavigationIcon';
import {SplashScreen} from '../components/SplashScreen';
import {useSessionStore} from '../stores/session';
import {LoginScreen} from '../features/auth';
import {HomeScreen} from '../features/home';
import {
  EngineerDiscoveryScreen,
  EngineerProfileScreen,
} from '../features/engineers';
import {ProviderProfileScreen, ScanScreen} from '../features/reviews';
import {RequestsScreen} from '../features/requests';
import {MessagingScreen, ChatScreen} from '../features/messaging';
import {NotificationsScreen} from '../features/notifications';
import {SavedScreen} from '../features/favorites';
import {HelpScreen} from '../features/services';
import {ProfileScreen} from '../features/profile';
import {SearchScreen} from '../features/search';
import {RequestDetailScreen} from '../screens/RequestDetailScreen';
import {SettingsScreen} from '../screens/SettingsScreen';
import {AiPlannerScreen} from '../screens/AiPlannerScreen';
import {ProfileSetupModal} from '../components/ProfileSetupModal';
import {navigationRef, usePushNavigation} from './usePushNavigation';
import {usePersistedNavigationState} from './navigationPersistence';
import type {RootStackParamList, MainTabParamList} from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

function AccountGate({children, title, heading, message}: {
  children: React.ReactNode;
  title: string;
  heading: string;
  message: string;
}) {
  const token = useSessionStore(state => state.accessToken);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  if (token) return <>{children}</>;
  return (
    <View style={styles.gateRoot}>
      <AppHeader title={title} tab />
      <View style={styles.gateContent}>
        <Text accessibilityRole="header" style={styles.gateHeading}>{heading}</Text>
        <Text style={styles.gateMessage}>{message}</Text>
        <Button
          label="Sign in or create account"
          onPress={() => navigation.navigate('Login')}
        />
      </View>
    </View>
  );
}
function PrivateRequests() {
  return (
    <AccountGate title="My requests" heading="Keep track of every request" message="Sign in to see consultations, service visits and their latest updates.">
      <RequestsScreen />
    </AccountGate>
  );
}
function PrivateMessages() {
  return (
    <AccountGate title="Messages" heading="Your conversations, together" message="Sign in to chat as soon as your request exists — no need to wait for acceptance.">
      <MessagingScreen />
    </AccountGate>
  );
}
function PrivateProfile() {
  return (
    <AccountGate title="My profile" heading="Your home details in one place" message="Sign in to manage your location, saved professionals and account settings.">
      <ProfileScreen />
    </AccountGate>
  );
}
const styles = StyleSheet.create({
  gateRoot: {flex: 1, backgroundColor: '#F7F9FC'},
  gateContent: {padding: 24, paddingTop: 32, gap: 16},
  gateHeading: {fontSize: 23, lineHeight: 29, fontWeight: '700', color: Colors.navyDeep},
  gateMessage: {fontSize: 16, lineHeight: 24, color: '#667085'},
});
function LoginRoute({
  route,
}: NativeStackScreenProps<RootStackParamList, 'Login'>) {
  const token = useSessionStore(state => state.accessToken);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  React.useEffect(() => {
    if (token && navigation.canGoBack()) navigation.goBack();
  }, [token, navigation]);
  return <LoginScreen initialMode={route.params?.mode} />;
}

const TAB_ICONS: Record<keyof MainTabParamList, NavigationIconName> = {
  Home: 'home',
  Discover: 'find',
  Requests: 'requests',
  Messages: 'messages',
  Profile: 'profile',
};

const TAB_LABELS: Record<keyof MainTabParamList, string> = {
  Home: 'Home',
  Discover: 'Find',
  Requests: 'Requests',
  Messages: 'Messages',
  Profile: 'Profile',
};

function MainTabs() {
  const insets = useSafeAreaInsets();
  const {fontScale, width} = useWindowDimensions();
  return (
    <Tab.Navigator
      screenOptions={({route}) => ({
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarLabelPosition: 'below-icon',
        tabBarStyle: {
          backgroundColor: Colors.navyDeep,
          borderTopWidth: 0,
          elevation: 8,
          shadowColor: Colors.navyDeep,
          shadowOpacity: 0.16,
          shadowRadius: 12,
          shadowOffset: {width: 0, height: 4},
          marginHorizontal: width < 360 ? 4 : 12,
          marginBottom: 10,
          borderRadius: 22,
          paddingBottom: Math.max(insets.bottom, 2),
          paddingTop: 8,
          height: 68 + Math.max(insets.bottom, 2) + Math.max(0, fontScale - 1) * 24,
        },
        tabBarActiveTintColor: ClientColors.white,
        tabBarInactiveTintColor: Colors.slate300,
        tabBarLabelStyle: {
          fontSize: width < 360 ? 9 : 12,
          fontWeight: '600',
          width: '100%',
          textAlign: 'center',
        },
        tabBarItemStyle: {minHeight: 56, paddingHorizontal: 0, borderRadius: 14},
        tabBarIconStyle: {marginBottom: 3},
        tabBarIcon: ({color, focused}) => (
          <NavigationIcon
            name={TAB_ICONS[route.name as keyof MainTabParamList]}
            color={focused ? ClientColors.accent : color}
            focused={focused}
          />
        ),
      })}>
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{tabBarLabel: TAB_LABELS.Home}}
      />
      <Tab.Screen
        name="Discover"
        component={EngineerDiscoveryScreen}
        options={{tabBarLabel: TAB_LABELS.Discover}}
      />
      <Tab.Screen
        name="Requests"
        component={PrivateRequests}
        options={{tabBarLabel: TAB_LABELS.Requests}}
      />
      <Tab.Screen
        name="Messages"
        component={PrivateMessages}
        options={{tabBarLabel: width < 360 ? 'Inbox' : TAB_LABELS.Messages}}
      />
      <Tab.Screen
        name="Profile"
        component={PrivateProfile}
        options={{tabBarLabel: TAB_LABELS.Profile}}
      />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  const [splashFinished, setSplashFinished] = useState(false);
  const hasSession = useSessionStore(s => !!s.accessToken || s.isGuest);
  const isHydrated = useSessionStore(s => s.isHydrated);
  const hydrateSession = useSessionStore(s => s.hydrateSession);
  const token = useSessionStore(s => s.accessToken);
  const accountKey = useSessionStore(s => s.user?.id ?? 'guest');
  const persistedNav = usePersistedNavigationState(accountKey, isHydrated, true);
  usePushNavigation(splashFinished && !!token);

  React.useEffect(() => {
    void hydrateSession();
  }, [hydrateSession]);

  if (!splashFinished || !isHydrated || !persistedNav.ready) {
    return (
      <SplashScreen
        isReady={isHydrated && persistedNav.ready}
        instant={!!persistedNav.initialState}
        onFinish={() => setSplashFinished(true)}
      />
    );
  }

  if (!hasSession) {
    return <LoginScreen />;
  }

  return (
    <NavigationContainer
      key={accountKey}
      ref={navigationRef}
      linking={linking}
      initialState={persistedNav.initialState}
      onStateChange={persistedNav.onStateChange}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          animationDuration: 260,
          gestureEnabled: true,
        }}>
        <Stack.Screen name="MainTabs" component={MainTabs} />
        <Stack.Screen
          name="EngineerDiscovery"
          component={EngineerDiscoveryScreen}
        />
        <Stack.Screen name="Search" component={SearchScreen} />
        <Stack.Screen name="Services" component={ServicesScreen} />
        <Stack.Screen
          name="ServiceProviders"
          component={ServiceProvidersScreen}
        />
        <Stack.Screen name="ServiceHistory" component={PlatformHistoryScreen} />
        <Stack.Screen
          name="ActivityHistory"
          component={ActivityHistoryScreen}
        />
        <Stack.Screen
          name="ServiceRequestDetail"
          component={ServiceRequestDetailScreen}
        />
        <Stack.Screen name="Login" component={LoginRoute} />
        <Stack.Screen name="RequestDetail" component={RequestDetailScreen} />
        <Stack.Screen name="MapPreview" component={MapPreviewScreen} />
        <Stack.Screen name="Chat" component={ChatScreen} />
        <Stack.Screen
          name="EngineerProfile"
          component={EngineerProfileScreen}
        />
        <Stack.Screen
          name="ProviderProfile"
          component={ProviderProfileScreen}
        />
        <Stack.Screen name="Scan" component={ScanScreen} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} />
        <Stack.Screen name="Saved" component={SavedScreen} />
        <Stack.Screen name="Help" component={HelpScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="AiPlanner" component={AiPlannerScreen} />
      </Stack.Navigator>
      <ProfileSetupModal />
    </NavigationContainer>
  );
}
