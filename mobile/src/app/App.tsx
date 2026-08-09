import { useSessionStore } from '@features/auth/sessionStore';
import { useAuthBootstrap } from '@features/auth/useAuthBootstrap';
import { useAppPresence } from '@features/messages/useAppPresence';
import { AppErrorBoundary } from '@shared/components';
import { queryClient } from '@shared/lib/queryClient';
import { colors } from '@shared/theme';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { useEffect } from 'react';
import { Image, StatusBar, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from './navigation/RootNavigator';

function Bootstrap() {
  useAuthBootstrap();
  const userId = useSessionStore(state => state.session?.user.id ?? null);
  useAppPresence(userId);
  useEffect(() => () => queryClient.clear(), []);
  return <RootNavigator />;
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Inter: require('../assets/fonts/Inter.ttf'),
    Manrope: require('../assets/fonts/Manrope.ttf'),
  });

  if (fontError) throw fontError;
  if (!fontsLoaded) {
    return (
      <View style={styles.loading}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.canvas} />
        <Image
          source={require('../assets/images/etkinlink-symbol.png')}
          resizeMode="contain"
          accessibilityLabel="EtkinLink"
          style={styles.splashIcon}
        />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AppErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <StatusBar
              barStyle="dark-content"
              backgroundColor={colors.canvas}
            />
            <Bootstrap />
          </QueryClientProvider>
        </AppErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
  },
  splashIcon: { width: 176, height: 176 },
});
