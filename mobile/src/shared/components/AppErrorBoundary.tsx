import { colors, spacing } from '@shared/theme';
import type { ErrorInfo, PropsWithChildren, ReactNode } from 'react';
import { Component } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppButton } from './AppButton';
import { AppText } from './AppText';

type AppErrorBoundaryState = {
  hasError: boolean;
};

type AppErrorBoundaryProps = PropsWithChildren<{
  fallback?: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}>;

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  override state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  private retry = () => {
    this.setState({ hasError: false });
  };

  override render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <View style={styles.container} accessibilityRole="alert">
        <AppText variant="headingMd" align="center">
          Bir sorun oluştu
        </AppText>
        <AppText tone="secondary" align="center">
          Uygulama bu ekranı açamadı. Yeniden deneyebilirsin.
        </AppText>
        <AppButton label="Tekrar dene" fullWidth={false} onPress={this.retry} />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 320,
    backgroundColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
});
