import { colors, spacing } from '@shared/theme';
import type { LucideProps } from 'lucide-react-native';
import { CircleAlert, Inbox } from 'lucide-react-native';
import type { ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppButton } from './AppButton';
import { AppText } from './AppText';

type StateViewProps = {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: ComponentType<LucideProps>;
};

export function StateView({
  title,
  description,
  actionLabel,
  onAction,
  icon: Icon = Inbox,
}: StateViewProps) {
  return (
    <View style={styles.container} accessibilityRole="summary">
      <View style={styles.iconWrap}>
        <Icon size={24} color={colors.brand} />
      </View>
      <AppText variant="heading18" align="center">
        {title}
      </AppText>
      <AppText tone="secondary" align="center">
        {description}
      </AppText>
      {actionLabel && onAction ? (
        <AppButton label={actionLabel} fullWidth={false} onPress={onAction} />
      ) : null}
    </View>
  );
}

export function ErrorState(props: Omit<StateViewProps, 'icon'>) {
  return <StateView {...props} icon={CircleAlert} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 240,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
});
