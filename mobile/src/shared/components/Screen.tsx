import { colors, layout } from '@shared/theme';
import { useQueryClient } from '@tanstack/react-query';
import type { PropsWithChildren, Ref } from 'react';
import { useState } from 'react';
import type { ScrollViewProps, StyleProp, ViewStyle } from 'react-native';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';
import { SafeAreaView } from 'react-native-safe-area-context';

type ScreenProps = PropsWithChildren<{
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  keyboardShouldPersistTaps?: ScrollViewProps['keyboardShouldPersistTaps'];
  refreshing?: boolean;
  onRefresh?: () => void | Promise<void>;
  refreshEnabled?: boolean;
  scrollRef?: Ref<ScrollView>;
  safeAreaEdges?: Edge[];
  testID?: string;
}>;

const defaultSafeAreaEdges: Edge[] = ['top', 'right', 'bottom', 'left'];
export const mainTabSafeAreaEdges: Edge[] = ['top', 'right', 'left'];

export function Screen({
  scroll = false,
  contentStyle,
  keyboardShouldPersistTaps = 'handled',
  refreshing,
  onRefresh,
  refreshEnabled = true,
  scrollRef,
  safeAreaEdges = defaultSafeAreaEdges,
  testID,
  children,
}: ScreenProps) {
  const queryClient = useQueryClient();
  const [defaultRefreshing, setDefaultRefreshing] = useState(false);

  async function refresh(): Promise<void> {
    if (onRefresh) {
      await onRefresh();
      return;
    }
    setDefaultRefreshing(true);
    try {
      await queryClient.refetchQueries({ type: 'active' });
    } finally {
      setDefaultRefreshing(false);
    }
  }

  if (scroll) {
    return (
      <SafeAreaView
        style={styles.safeArea}
        edges={safeAreaEdges}
        testID={testID}
      >
        <ScrollView
          ref={scrollRef}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scrollContent, contentStyle]}
          refreshControl={
            refreshEnabled ? (
              <RefreshControl
                refreshing={refreshing ?? defaultRefreshing}
                onRefresh={() => void refresh()}
                tintColor={colors.brand}
                colors={[colors.brand]}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={styles.safeArea} edges={safeAreaEdges} testID={testID}>
      <View style={[styles.content, contentStyle]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
  },
  scrollContent: {
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
  },
});
