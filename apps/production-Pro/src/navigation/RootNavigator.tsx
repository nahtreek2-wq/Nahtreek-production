import React, {useCallback, useEffect, useState} from 'react';
import {StyleSheet, useWindowDimensions, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {NavigationIcon, NavigationIconName} from '../../../../packages/mobile-ui/NavigationIcon';
import {Colors} from '@nahtreek/design-system';
import {ProColors} from '../theme/professionalTheme';
import type {
  MainTabParamList,
  MessagesStackParamList,
  ProfileStackParamList,
  RequestsStackParamList,
  RootStackParamList,
} from './types';
import {ProfessionalTypeScreen} from '../screens/ProfessionalTypeScreen';
import {IdentitySetupScreen} from '../screens/IdentitySetupScreen';
import {HomeScreen} from '../screens/HomeScreen';
import {RequestsScreen} from '../screens/RequestsScreen';
import {ScheduleScreen} from '../screens/ScheduleScreen';
import {MessagesScreen} from '../screens/MessagesScreen';
import {ProfileScreen} from '../screens/ProfileScreen';
import {AccountAccessScreen} from '../screens/AccountAccessScreen';
import {useSessionStore} from '../stores/session';
import {RequestDetailScreen} from '../screens/RequestDetailScreen';
import {MapPreviewScreen} from '../screens/MapPreviewScreen';
import {ProfessionalSetupScreen} from '../screens/ProfessionalSetupScreen';
import {ChatScreen} from '../screens/ChatScreen';
import {SplashScreen} from '../components/SplashScreen';
import {NotificationsScreen} from '../screens/NotificationsScreen';
import {NotificationSettingsScreen} from '../screens/NotificationSettingsScreen';
import {PublicProfilePreviewScreen} from '../screens/PublicProfilePreviewScreen';
import {VerificationDocumentsScreen} from '../screens/VerificationDocumentsScreen';
import {ReviewsScreen} from '../screens/ReviewsScreen';
import {MembershipScreen} from '../screens/MembershipScreen';
import {DuesScreen} from '../screens/DuesScreen';
import {MyQrScreen} from '../screens/MyQrScreen';
import {SupportScreen} from '../screens/SupportScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();
const RequestsStack = createNativeStackNavigator<RequestsStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();
const MessagesStack = createNativeStackNavigator<MessagesStackParamList>();

const icons: Record<keyof MainTabParamList, NavigationIconName> = {
  Home: 'home',
  Requests: 'jobs',
  Schedule: 'schedule',
  Messages: 'messages',
  Profile: 'profile',
};

function MainTabs() {
  const insets = useSafeAreaInsets();
  const {fontScale, width} = useWindowDimensions();
  return (
    <Tabs.Navigator
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
        tabBarActiveTintColor: Colors.white,
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
            name={icons[route.name]}
            color={focused ? ProColors.accent : color}
            focused={focused}
          />
        ),
      })}>
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen
        name="Requests"
        component={RequestsNavigator}
        options={{tabBarLabel: 'Jobs'}}
      />
      <Tabs.Screen
        name="Schedule"
        component={ScheduleScreen}
        options={{tabBarLabel: 'Time'}}
      />
      <Tabs.Screen
        name="Messages"
        component={MessagesNavigator}
        options={{tabBarLabel: 'Chat'}}
      />
      <Tabs.Screen
        name="Profile"
        component={ProfileNavigator}
        options={{tabBarLabel: 'Profile'}}
      />
    </Tabs.Navigator>
  );
}
function RequestsNavigator() {
  return (
    <RequestsStack.Navigator
      screenOptions={{headerShown: false, animation: 'slide_from_right'}}>
      <RequestsStack.Screen name="RequestInbox" component={RequestsScreen} />
      <RequestsStack.Screen
        name="RequestDetail"
        component={RequestDetailScreen}
      />
      <RequestsStack.Screen name="MapPreview" component={MapPreviewScreen} />
    </RequestsStack.Navigator>
  );
}

function ProfileNavigator() {
  return (
    <ProfileStack.Navigator
      screenOptions={{headerShown: false, animation: 'slide_from_right'}}>
      <ProfileStack.Screen name="ProfileOverview" component={ProfileScreen} />
      <ProfileStack.Screen name="Reviews" component={ReviewsScreen} />
      <ProfileStack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
      <ProfileStack.Screen
        name="PublicProfilePreview"
        component={PublicProfilePreviewScreen}
      />
      <ProfileStack.Screen
        name="ProfessionalSetup"
        component={ProfessionalSetupScreen}
      />
      <ProfileStack.Screen
        name="VerificationDocuments"
        component={VerificationDocumentsScreen}
      />
      <ProfileStack.Screen
        name="Notifications"
        component={NotificationsScreen}
      />
      <ProfileStack.Screen
        name="Membership"
        component={MembershipScreen}
      />
      <ProfileStack.Screen
        name="Dues"
        component={DuesScreen}
      />
      <ProfileStack.Screen
        name="MyQr"
        component={MyQrScreen}
      />
      <ProfileStack.Screen
        name="Support"
        component={SupportScreen}
      />
    </ProfileStack.Navigator>
  );
}

function MessagesNavigator() {
  return (
    <MessagesStack.Navigator
      screenOptions={{headerShown: false, animation: 'slide_from_right'}}>
      <MessagesStack.Screen name="Conversations" component={MessagesScreen} />
      <MessagesStack.Screen name="Chat" component={ChatScreen} />
    </MessagesStack.Navigator>
  );
}

export function RootNavigator({instantSplash = false}: {instantSplash?: boolean} = {}) {
  // A returning pro with a restorable session must never sit through the
  // logo animation again — cold starts after a background kill go straight
  // to their last screen. The splash plays only on true fresh starts.
  const [splashFinished, setSplashFinished] = useState(instantSplash);
  const hydrated = useSessionStore(state => state.hydrated);
  const accessToken = useSessionStore(state => state.accessToken);
  const user = useSessionStore(state => state.user);
  const hydrate = useSessionStore(state => state.hydrate);
  useEffect(() => {
    hydrate().catch(() => undefined);
  }, [hydrate]);
  const finishSplash = useCallback(() => setSplashFinished(true), []);
  if (!hydrated && instantSplash) {
    return <View style={bootStyles.root} />;
  }
  if (!hydrated || !splashFinished) {
    return <SplashScreen ready={hydrated} instant={instantSplash} onFinish={finishSplash} />;
  }
  if (!accessToken || !user) {
    return (
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
        }}>
        <Stack.Screen
          name="ProfessionalType"
          component={ProfessionalTypeScreen}
        />
        <Stack.Screen name="AccountAccess" component={AccountAccessScreen} />
      </Stack.Navigator>
    );
  }
  if (user.needsProfessionalProfile) {
    return (
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
        }}>
        <Stack.Screen name="IdentitySetup" component={IdentitySetupScreen} />
      </Stack.Navigator>
    );
  }
  return (
    <Stack.Navigator
      screenOptions={{headerShown: false, animation: 'slide_from_right'}}>
      <Stack.Screen
        name="Main"
        component={MainTabs}
        options={{gestureEnabled: false}}
      />
    </Stack.Navigator>
  );
}

const bootStyles = StyleSheet.create({
  root: {flex: 1, backgroundColor: ProColors.deep},
});
