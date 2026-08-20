import { useSessionStore } from '@features/auth/sessionStore';
import { useAuthBootstrap } from '@features/auth/useAuthBootstrap';
import { AppErrorBoundary } from '@shared/components';
import { queryClient } from '@shared/lib/queryClient';
import {
  publicQueryPersister,
  queryCacheBuster,
  queryCacheMaxAgeMs,
  shouldPersistQueryKey,
} from '@shared/lib/queryPersistence';
import { captureAppError, recordPerformance } from '@shared/lib/telemetry';
import { colors } from '@shared/theme';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
import { useEffect } from 'react';
import { Image, StatusBar, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from './navigation/RootNavigator';
import { DeferredAppServices } from './startup/DeferredAppServices';

const appModuleStartedAt = global.performance?.now?.() ?? Date.now();

function Bootstrap() {
  useAuthBootstrap();
  const userId = useSessionStore(state => state.session?.user.id ?? null);
  useEffect(() => () => queryClient.clear(), []);
  return (
    <>
      <RootNavigator />
      <DeferredAppServices userId={userId} />
    </>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Inter: require('../assets/fonts/Inter.ttf'),
    Manrope: require('../assets/fonts/Manrope.ttf'),
  });

  useEffect(() => {
    if (!fontsLoaded) return;
    recordPerformance(
      'startup.fonts_ready',
      (global.performance?.now?.() ?? Date.now()) - appModuleStartedAt,
    );
  }, [fontsLoaded]);

  if (fontError) throw fontError;
  if (!fontsLoaded) {
    return (
      <View style={styles.loading}>
        <StatusBar barStyle="dark-content" backgroundColor={colors.canvas} />
        <Image
          source={require('../assets/images/etkinlink-logo.png')}
          resizeMode="contain"
          accessibilityLabel="EtkinLink"
          style={styles.splashLogo}
        />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AppErrorBoundary
          onError={(error, info) =>
            captureAppError(error, { componentStack: info.componentStack })
          }
        >
          <PersistQueryClientProvider
            client={queryClient}
            persistOptions={{
              buster: queryCacheBuster,
              maxAge: queryCacheMaxAgeMs,
              persister: publicQueryPersister,
              dehydrateOptions: {
                shouldDehydrateQuery: query =>
                  query.state.status === 'success' &&
                  shouldPersistQueryKey(query.queryKey),
              },
            }}
            onSuccess={() =>
              recordPerformance(
                'startup.cache_restored',
                (global.performance?.now?.() ?? Date.now()) -
                  appModuleStartedAt,
              )
            }
          >
            <StatusBar
              barStyle="dark-content"
              backgroundColor={colors.canvas}
            />
            <Bootstrap />
          </PersistQueryClientProvider>
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
  splashLogo: { width: 280, height: 220 },
});
