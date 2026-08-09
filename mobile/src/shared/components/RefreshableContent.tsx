import { colors } from '@shared/theme';
import type { PropsWithChildren } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';

type RefreshableContentProps = PropsWithChildren<{
  refreshing: boolean;
  onRefresh: () => void;
  contentStyle?: StyleProp<ViewStyle>;
}>;

export function RefreshableContent({
  refreshing,
  onRefresh,
  contentStyle,
  children,
}: RefreshableContentProps) {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, contentStyle]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.brand}
          colors={[colors.brand]}
        />
      }
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { flexGrow: 1 },
});
