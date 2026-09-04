import { useNetInfo } from '@react-native-community/netinfo';
import { AppText } from '@shared/components';
import { colors, spacing } from '@shared/theme';
import { RefreshCw, WifiOff } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

export function ConnectivityBanner() {
  const state = useNetInfo();
  if (state.isConnected !== false && state.isInternetReachable !== false)
    return null;
  const reconnecting =
    state.isConnected === true && state.isInternetReachable === null;
  return (
    <View accessibilityRole="alert" style={styles.banner}>
      {reconnecting ? (
        <RefreshCw size={16} color={colors.warning} />
      ) : (
        <WifiOff size={16} color={colors.warning} />
      )}
      <AppText variant="caption" style={styles.text}>
        {reconnecting
          ? 'Bağlantı geri geliyor…'
          : 'Çevrimdışısın. Son yüklenen içerikler gösteriliyor.'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.warningSoft,
    paddingHorizontal: spacing.md,
  },
  text: { flexShrink: 1 },
});
