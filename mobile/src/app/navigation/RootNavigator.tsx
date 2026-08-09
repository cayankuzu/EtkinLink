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
import {
  CompleteOnboardingScreen,
  InterestsScreen,
  PhotosScreen,
  ProfileBasicsScreen,
} from '@features/onboarding/screens';
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
  NavigationContainer,
} from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AppText } from '@shared/components';
import { colors, typography } from '@shared/theme';
import {
  Compass,
  HeartHandshake,
  Link2,
  MessageSquare,
  UserRound,
  UsersRound,
} from 'lucide-react-native';
import { StatusBar, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type {
  AuthStackParamList,
  DiscoverStackParamList,
  MainTabParamList,
  MatchesStackParamList,
  MessagesStackParamList,
  OnboardingStackParamList,
  ProfileStackParamList,
  RoomsStackParamList,
} from './types';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const OnboardingStack = createNativeStackNavigator<OnboardingStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();
const DiscoverStack = createNativeStackNavigator<DiscoverStackParamList>();
const RoomsStack = createNativeStackNavigator<RoomsStackParamList>();
const MatchesStack = createNativeStackNavigator<MatchesStackParamList>();
const MessagesStack = createNativeStackNavigator<MessagesStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();

function DiscoverIcon({ color }: { color: string }) {
  return <Compass size={23} color={color} />;
}

function RoomsIcon({ color }: { color: string }) {
  return <UsersRound size={23} color={color} />;
}

function MessagesIcon({ color }: { color: string }) {
  return <MessageSquare size={23} color={color} />;
}

function MatchesIcon({ color }: { color: string }) {
  return <HeartHandshake size={23} color={color} />;
}

function ProfileIcon({ color }: { color: string }) {
  return <UserRound size={23} color={color} />;
}

const linking = {
  prefixes: ['etkinlink://'],
  config: {
    screens: {
      NewPassword: 'auth/reset-password',
    },
  },
};

function AuthNavigator({
  pendingVerificationEmail,
}: {
  pendingVerificationEmail: string | null;
}) {
  return (
    <AuthStack.Navigator
      initialRouteName={pendingVerificationEmail ? 'EmailSent' : 'Welcome'}
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

function OnboardingNavigator({
  initialRouteName,
}: {
  initialRouteName: 'ProfileBasics';
}) {
  return (
    <OnboardingStack.Navigator
      initialRouteName={initialRouteName}
      screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
    >
      <OnboardingStack.Screen
        name="ProfileBasics"
        component={ProfileBasicsScreen}
      />
      <OnboardingStack.Screen name="Interests" component={InterestsScreen} />
      <OnboardingStack.Screen name="Photos" component={PhotosScreen} />
      <OnboardingStack.Screen
        name="Complete"
        component={CompleteOnboardingScreen}
      />
    </OnboardingStack.Navigator>
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

function RoomsEventDetailScreen(
  props: NativeStackScreenProps<RoomsStackParamList, 'EventDetail'>,
) {
  return (
    <EventDetailScreen
      {...(props as unknown as NativeStackScreenProps<
        DiscoverStackParamList,
        'EventDetail'
      >)}
    />
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
      <RoomsStack.Screen
        name="EventDetail"
        component={RoomsEventDetailScreen}
      />
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

function MessagesEventDetailScreen(
  props: NativeStackScreenProps<MessagesStackParamList, 'EventDetail'>,
) {
  return (
    <EventDetailScreen
      {...(props as unknown as NativeStackScreenProps<
        DiscoverStackParamList,
        'EventDetail'
      >)}
    />
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
      <MessagesStack.Screen
        name="EventDetail"
        component={MessagesEventDetailScreen}
      />
      <MessagesStack.Screen
        name="PublicProfile"
        component={PublicProfileScreen}
      />
    </MessagesStack.Navigator>
  );
}

function ProfileEventDetailScreen(
  props: NativeStackScreenProps<ProfileStackParamList, 'EventDetail'>,
) {
  return (
    <EventDetailScreen
      {...(props as unknown as NativeStackScreenProps<
        DiscoverStackParamList,
        'EventDetail'
      >)}
    />
  );
}
function ProfilePublicProfileScreen(
  props: NativeStackScreenProps<ProfileStackParamList, 'PublicProfile'>,
) {
  return (
    <PublicProfileScreen
      {...(props as unknown as NativeStackScreenProps<
        MessagesStackParamList,
        'PublicProfile'
      >)}
    />
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
        component={ProfilePublicProfileScreen}
      />
      <ProfileStack.Screen
        name="EventDetail"
        component={ProfileEventDetailScreen}
      />
    </ProfileStack.Navigator>
  );
}

function MainTabs() {
  const insets = useSafeAreaInsets();
  const visibleTabBarStyle = [
    styles.tabBar,
    {
      height: 60 + insets.bottom,
      paddingBottom: Math.max(insets.bottom, 8),
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
  const pendingVerificationEmail = useSessionStore(
    state => state.pendingVerificationEmail,
  );
  if (phase === 'booting') {
    return <SplashScreen />;
  }
  return (
    <NavigationContainer linking={linking}>
      {phase === 'signedOut' ? (
        <AuthNavigator
          key={pendingVerificationEmail ?? 'welcome'}
          pendingVerificationEmail={pendingVerificationEmail}
        />
      ) : phase === 'onboarding' ? (
        <OnboardingNavigator initialRouteName="ProfileBasics" />
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
      <StatusBar barStyle="light-content" backgroundColor={colors.brand} />
      <View style={styles.splashCenter}>
        <View style={styles.splashMark}>
          <Link2 size={32} color={colors.textInverse} />
        </View>
        <AppText variant="heading24" tone="inverse">
          EtkinLink
        </AppText>
        <AppText variant="tiny11" tone="inverse" align="center">
          Etkinlik etrafında güvenli sosyalleşme
        </AppText>
      </View>
      <View style={[styles.splashFooter, { bottom: insets.bottom + 16 }]}>
        <AppText variant="tiny11" tone="inverse" align="center">
          © 2026 EtkinLink
        </AppText>
        <AppText variant="tiny11" tone="inverse" align="center">
          MeMoDe tarafından
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.brand,
  },
  splashCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  splashMark: {
    width: 60,
    height: 60,
    marginBottom: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashFooter: { position: 'absolute', left: 0, right: 0 },
  tabBar: {
    paddingTop: 8,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabIcon: { marginTop: 1 },
  tabLabel: { ...typography.caption12, marginTop: 1 },
  hiddenTabBar: { display: 'none' },
});
