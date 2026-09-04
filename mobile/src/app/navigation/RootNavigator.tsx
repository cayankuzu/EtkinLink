import {
  EmailSentScreen,
  ForgotPasswordScreen,
  NewPasswordScreen,
  ResetEmailSentScreen,
  SignInScreen,
  SignUpInterestsScreen,
  SignUpPhotosScreen,
  SignUpProfileScreen,
  SignUpReviewScreen,
  SignUpScreen,
  WelcomeScreen,
} from '@features/auth/screens';
import { useSessionStore } from '@features/auth/sessionStore';
import { CityPickerScreen } from '@features/events/CityPickerScreen';
import { DiscoverScreen } from '@features/events/DiscoverScreen';
import { EventDetailScreen } from '@features/events/EventDetailScreen';
import { EventFiltersScreen } from '@features/events/EventFiltersScreen';
import { EventSearchScreen } from '@features/events/EventSearchScreen';
import { SavedEventsScreen } from '@features/events/SavedEventsScreen';
import { MatchCardsScreen } from '@features/matching/MatchCardsScreen';
import { MatchFiltersScreen } from '@features/matching/MatchFiltersScreen';
import { MatchHubScreen } from '@features/matching/MatchHubScreen';
import { MatchingLikesScreen } from '@features/matching/MatchingLikesScreen';
import { MatchProfileEditScreen } from '@features/matching/MatchProfileEditScreen';
import { ChatSettingsScreen } from '@features/messages/ChatSettingsScreen';
import { DirectChatScreen } from '@features/messages/DirectChatScreen';
import { MessagesScreen } from '@features/messages/MessagesScreen';
import { AboutLegalScreen } from '@features/profile/AboutLegalScreen';
import { BlockedUsersScreen } from '@features/profile/BlockedUsersScreen';
import { ChangePasswordScreen } from '@features/profile/ChangePasswordScreen';
import { EditInterestsScreen } from '@features/profile/EditInterestsScreen';
import { EditPhotosScreen } from '@features/profile/EditPhotosScreen';
import { EditProfileScreen } from '@features/profile/EditProfileScreen';
import { ProfileMatchFiltersScreen } from '@features/profile/ProfileMatchFiltersScreen';
import { ProfileScreen } from '@features/profile/ProfileScreen';
import { ProfileVisibilityScreen } from '@features/profile/ProfileVisibilityScreen';
import { PublicProfileScreen } from '@features/profile/PublicProfileScreen';
import { SettingsScreen } from '@features/profile/SettingsScreen';
import { RoomDetailScreen } from '@features/rooms/RoomDetailScreen';
import { RoomParticipantsScreen } from '@features/rooms/RoomParticipantsScreen';
import { RoomsScreen } from '@features/rooms/RoomsScreen';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  getFocusedRouteNameFromRoute,
  getStateFromPath,
  NavigationContainer,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AppText } from '@shared/components';
import { colors, layout, typography } from '@shared/theme';
import {
  Compass,
  HeartHandshake,
  MessageSquare,
  UserRound,
  UsersRound,
} from 'lucide-react-native';
import { Image, StatusBar, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { sanitizeDeepLinkPath } from './deepLinkPath';
import {
  navigationRef,
  useNotificationNavigation,
} from './notificationNavigation';
import type {
  AuthStackParamList,
  DiscoverStackParamList,
  MainTabParamList,
  MatchesStackParamList,
  MessagesStackParamList,
  ProfileStackParamList,
  RoomsStackParamList,
} from './types';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();
const DiscoverStack = createNativeStackNavigator<DiscoverStackParamList>();
const RoomsStack = createNativeStackNavigator<RoomsStackParamList>();
const MatchesStack = createNativeStackNavigator<MatchesStackParamList>();
const MessagesStack = createNativeStackNavigator<MessagesStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();

function DiscoverIcon({ color }: { color: string }) {
  return <Compass size={20} color={color} />;
}

function RoomsIcon({ color }: { color: string }) {
  return <UsersRound size={20} color={color} />;
}

function MessagesIcon({ color }: { color: string }) {
  return <MessageSquare size={20} color={color} />;
}

function MatchesIcon({ color }: { color: string }) {
  return <HeartHandshake size={20} color={color} />;
}

function ProfileIcon({ color }: { color: string }) {
  return <UserRound size={20} color={color} />;
}

const linkingConfig = {
  screens: {
    NewPassword: 'auth/reset-password',
  },
};

const linking = {
  prefixes: ['etkinlink://'],
  config: linkingConfig,
  // Any app on the device can open an `etkinlink://` URL, and React
  // Navigation's default parser would hand its query string to a decoder with
  // an unfixed denial-of-service advisory. No supported route uses a query
  // string, so bound the path first. See `deepLinkPath.ts`.
  getStateFromPath: (
    path: string,
    options?: Parameters<typeof getStateFromPath>[1],
  ) => {
    const safePath = sanitizeDeepLinkPath(path);
    if (safePath === undefined) return undefined;
    return getStateFromPath(safePath, options);
  },
};

function AuthNavigator({
  pendingVerificationEmail,
  recovering = false,
}: {
  pendingVerificationEmail: string | null;
  recovering?: boolean;
}) {
  return (
    <AuthStack.Navigator
      initialRouteName={
        recovering
          ? 'NewPassword'
          : pendingVerificationEmail
          ? 'EmailSent'
          : 'Welcome'
      }
      screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
    >
      <AuthStack.Screen name="Welcome" component={WelcomeScreen} />
      <AuthStack.Screen name="SignIn" component={SignInScreen} />
      <AuthStack.Screen name="SignUp" component={SignUpScreen} />
      <AuthStack.Screen name="SignUpProfile" component={SignUpProfileScreen} />
      <AuthStack.Screen
        name="SignUpInterests"
        component={SignUpInterestsScreen}
      />
      <AuthStack.Screen name="SignUpPhotos" component={SignUpPhotosScreen} />
      <AuthStack.Screen name="SignUpReview" component={SignUpReviewScreen} />
      <AuthStack.Screen
        name="EmailSent"
        component={EmailSentScreen}
        initialParams={
          pendingVerificationEmail
            ? { email: pendingVerificationEmail }
            : undefined
        }
        options={{ gestureEnabled: false }}
      />
      <AuthStack.Screen
        name="ForgotPassword"
        component={ForgotPasswordScreen}
      />
      <AuthStack.Screen
        name="ResetEmailSent"
        component={ResetEmailSentScreen}
      />
      <AuthStack.Screen name="NewPassword" component={NewPasswordScreen} />
    </AuthStack.Navigator>
  );
}

function DiscoverNavigator() {
  return (
    <DiscoverStack.Navigator
      screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
    >
      <DiscoverStack.Screen name="Discover" component={DiscoverScreen} />
      <DiscoverStack.Screen name="CityPicker" component={CityPickerScreen} />
      <DiscoverStack.Screen name="EventSearch" component={EventSearchScreen} />
      <DiscoverStack.Screen
        name="EventFilters"
        component={EventFiltersScreen}
        options={{ presentation: 'modal' }}
      />
      <DiscoverStack.Screen name="EventDetail" component={EventDetailScreen} />
      <DiscoverStack.Screen name="SavedEvents" component={SavedEventsScreen} />
    </DiscoverStack.Navigator>
  );
}

function RoomsNavigator() {
  return (
    <RoomsStack.Navigator
      screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
    >
      <RoomsStack.Screen name="Rooms" component={RoomsScreen} />
      <RoomsStack.Screen name="RoomDetail" component={RoomDetailScreen} />
      <RoomsStack.Screen
        name="RoomParticipants"
        component={RoomParticipantsScreen}
      />
      <RoomsStack.Screen name="MatchHub" component={MatchHubScreen} />
      <RoomsStack.Screen
        name="MatchProfileEdit"
        component={MatchProfileEditScreen}
      />
      <RoomsStack.Screen name="MatchCards" component={MatchCardsScreen} />
      <RoomsStack.Screen
        name="MatchFilters"
        component={MatchFiltersScreen}
        options={{ presentation: 'modal' }}
      />
      <RoomsStack.Screen name="EventDetail" component={EventDetailScreen} />
    </RoomsStack.Navigator>
  );
}

function MatchesNavigator() {
  return (
    <MatchesStack.Navigator screenOptions={{ headerShown: false }}>
      <MatchesStack.Screen name="Matches" component={MatchingLikesScreen} />
    </MatchesStack.Navigator>
  );
}

function MessagesNavigator() {
  return (
    <MessagesStack.Navigator
      screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
    >
      <MessagesStack.Screen name="Messages" component={MessagesScreen} />
      <MessagesStack.Screen name="DirectChat" component={DirectChatScreen} />
      <MessagesStack.Screen
        name="ChatSettings"
        component={ChatSettingsScreen}
      />
      <MessagesStack.Screen name="EventDetail" component={EventDetailScreen} />
      <MessagesStack.Screen
        name="PublicProfile"
        component={PublicProfileScreen}
      />
    </MessagesStack.Navigator>
  );
}

function ProfileNavigator() {
  return (
    <ProfileStack.Navigator
      screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
    >
      <ProfileStack.Screen name="Profile" component={ProfileScreen} />
      <ProfileStack.Screen name="EditProfile" component={EditProfileScreen} />
      <ProfileStack.Screen name="EditPhotos" component={EditPhotosScreen} />
      <ProfileStack.Screen
        name="EditInterests"
        component={EditInterestsScreen}
      />
      <ProfileStack.Screen
        name="ProfileVisibility"
        component={ProfileVisibilityScreen}
      />
      <ProfileStack.Screen
        name="MatchFilters"
        component={ProfileMatchFiltersScreen}
      />
      <ProfileStack.Screen
        name="ChangePassword"
        component={ChangePasswordScreen}
      />
      <ProfileStack.Screen name="Settings" component={SettingsScreen} />
      <ProfileStack.Screen name="AboutLegal" component={AboutLegalScreen} />
      <ProfileStack.Screen name="BlockedUsers" component={BlockedUsersScreen} />
      <ProfileStack.Screen
        name="PublicProfile"
        component={PublicProfileScreen}
      />
      <ProfileStack.Screen name="EventDetail" component={EventDetailScreen} />
    </ProfileStack.Navigator>
  );
}

function MainTabs() {
  const insets = useSafeAreaInsets();
  const visibleTabBarStyle = [
    styles.tabBar,
    {
      height: layout.tabBarHeight + insets.bottom,
      paddingBottom: Math.max(insets.bottom, 6),
    },
  ];
  return (
    <Tabs.Navigator
      initialRouteName="DiscoverTab"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: visibleTabBarStyle,
        tabBarLabelStyle: styles.tabLabel,
        tabBarIconStyle: styles.tabIcon,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="DiscoverTab"
        component={DiscoverNavigator}
        options={({ route }) => ({
          title: 'Keşfet',
          tabBarAccessibilityLabel: 'Keşfet sekmesi',
          tabBarIcon: DiscoverIcon,
          tabBarStyle:
            (getFocusedRouteNameFromRoute(route) ?? 'Discover') === 'Discover'
              ? visibleTabBarStyle
              : styles.hiddenTabBar,
        })}
      />
      <Tabs.Screen
        name="RoomsTab"
        component={RoomsNavigator}
        options={({ route }) => ({
          title: 'Odalar',
          tabBarAccessibilityLabel: 'Odalar sekmesi',
          tabBarIcon: RoomsIcon,
          tabBarStyle:
            (getFocusedRouteNameFromRoute(route) ?? 'Rooms') === 'Rooms'
              ? visibleTabBarStyle
              : styles.hiddenTabBar,
        })}
      />
      <Tabs.Screen
        name="MatchesTab"
        component={MatchesNavigator}
        options={{
          title: 'Eşleşme',
          tabBarAccessibilityLabel: 'Eşleşme sekmesi',
          tabBarIcon: MatchesIcon,
        }}
      />
      <Tabs.Screen
        name="MessagesTab"
        component={MessagesNavigator}
        options={({ route }) => ({
          title: 'Mesajlar',
          tabBarAccessibilityLabel: 'Mesajlar sekmesi',
          tabBarIcon: MessagesIcon,
          tabBarStyle:
            (getFocusedRouteNameFromRoute(route) ?? 'Messages') === 'Messages'
              ? visibleTabBarStyle
              : styles.hiddenTabBar,
        })}
      />
      <Tabs.Screen
        name="ProfileTab"
        component={ProfileNavigator}
        options={({ route }) => ({
          title: 'Profil',
          tabBarAccessibilityLabel: 'Profil sekmesi',
          tabBarIcon: ProfileIcon,
          tabBarStyle:
            (getFocusedRouteNameFromRoute(route) ?? 'Profile') === 'Profile'
              ? visibleTabBarStyle
              : styles.hiddenTabBar,
        })}
      />
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  const phase = useSessionStore(state => state.phase);
  useNotificationNavigation(phase === 'signedIn');
  const pendingVerificationEmail = useSessionStore(
    state => state.pendingVerificationEmail,
  );
  if (phase === 'booting') {
    return <SplashScreen />;
  }
  return (
    <NavigationContainer ref={navigationRef} linking={linking}>
      {phase === 'signedOut' || phase === 'recovery' ? (
        <AuthNavigator
          key={
            phase === 'recovery'
              ? 'recovery'
              : pendingVerificationEmail ?? 'welcome'
          }
          pendingVerificationEmail={pendingVerificationEmail}
          recovering={phase === 'recovery'}
        />
      ) : (
        <MainTabs />
      )}
    </NavigationContainer>
  );
}

function SplashScreen() {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.splash}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.canvas} />
      <View style={styles.splashCenter}>
        <Image
          source={require('../../assets/images/etkinlink-logo.png')}
          resizeMode="contain"
          accessibilityLabel="EtkinLink"
          style={styles.splashLogo}
        />
        <AppText variant="body14" tone="secondary" align="center">
          Etkinlik etrafında güvenli sosyalleşme
        </AppText>
      </View>
      <View style={[styles.splashFooter, { bottom: insets.bottom + 16 }]}>
        <AppText variant="tiny11" tone="tertiary" align="center">
          © 2026 EtkinLink
        </AppText>
        <AppText variant="tiny11" tone="tertiary" align="center">
          MeMoDe tarafından
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  splashCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  splashLogo: { width: 280, height: 220 },
  splashFooter: { position: 'absolute', left: 0, right: 0 },
  tabBar: {
    paddingTop: 6,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabIcon: { marginTop: 1 },
  tabLabel: { ...typography.tiny11, marginTop: 1 },
  hiddenTabBar: { display: 'none' },
});
