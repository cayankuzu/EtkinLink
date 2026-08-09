import { AppText } from '@shared/components';
import { colors, radius, spacing } from '@shared/theme';
import { Heart, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { SwipeQuota } from './matchingService';

const windowMs = 12 * 60 * 60_000;

type Props = { quota: SwipeQuota };

export function SwipeQuotaBar({ quota }: Props) {
  const deadline = useMemo(() => {
    const serverRemaining = Math.max(
      new Date(quota.resetAt).getTime() - new Date(quota.serverNow).getTime(),
      0,
    );
    return Date.now() + serverRemaining;
  }, [quota.resetAt, quota.serverNow]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [deadline]);

  const remainingMs = Math.max(deadline - now, 0);
  const elapsedPercent = Math.min(
    100,
    Math.max(0, ((windowMs - remainingMs) / windowMs) * 100),
  );

  return (
    <View style={styles.card} accessibilityLabel="Eşleşme hakları">
      <View style={styles.counts}>
        <QuotaCount
          icon={<Heart size={15} color={colors.brand} />}
          value={quota.remainingLikes}
          label="beğeni"
        />
        <QuotaCount
          icon={<X size={16} color={colors.danger} />}
          value={quota.remainingPasses}
          label="geç"
        />
        <AppText variant="tiny11" tone="secondary">
          {formatDuration(remainingMs)}
        </AppText>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${elapsedPercent}%` }]} />
      </View>
    </View>
  );
}

function QuotaCount({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <View style={styles.count} accessibilityLabel={`${value} ${label} hakkı`}>
      {icon}
      <AppText variant="caption12">{value}</AppText>
    </View>
  );
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.ceil(durationMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(
    2,
    '0',
  )}:${String(seconds).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  card: {
    gap: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  counts: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  count: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  track: {
    height: 4,
    borderRadius: radius.full,
    overflow: 'hidden',
    backgroundColor: colors.brandSoft,
  },
  fill: { height: 4, borderRadius: radius.full, backgroundColor: colors.brand },
});
