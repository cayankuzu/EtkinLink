import { AppText } from '@shared/components';
import { formatEventDate } from '@shared/lib/date';
import { colors, radius, spacing } from '@shared/theme';
import type { EventSourceDetails } from '@shared/types/domain';
import {
  CalendarDays,
  Clock3,
  Info as InfoIcon,
  Ticket,
  UserRound,
  UsersRound,
} from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

export function EventSourceDetailsSection({
  details,
}: {
  details: EventSourceDetails;
}) {
  const price = details.isAccessibleForFree
    ? 'Ücretsiz'
    : details.price
    ? `${details.price}${details.currency ? ` ${details.currency}` : ''}`
    : null;
  const rows: Array<{
    icon: typeof CalendarDays;
    label: string;
    value: string | null;
  }> = [
    {
      icon: InfoIcon,
      label: 'Etkinlik durumu',
      value: details.status ? sourceToken(details.status) : null,
    },
    {
      icon: UsersRound,
      label: 'Katılım biçimi',
      value: details.attendanceMode
        ? sourceToken(details.attendanceMode)
        : null,
    },
    { icon: UserRound, label: 'Düzenleyen', value: details.organizer },
    {
      icon: UsersRound,
      label: 'Sahne / konuşmacılar',
      value: details.performers.length ? details.performers.join(', ') : null,
    },
    { icon: Ticket, label: 'Ücret', value: price },
    {
      icon: Ticket,
      label: 'Bilet durumu',
      value: details.availability ? sourceToken(details.availability) : null,
    },
    { icon: UserRound, label: 'Yaş aralığı', value: details.ageRange },
    {
      icon: Clock3,
      label: 'Kapı açılışı',
      value: details.doorTime ? formatEventDate(details.doorTime) : null,
    },
    {
      icon: Clock3,
      label: 'Süre',
      value: details.duration ? durationLabel(details.duration) : null,
    },
    {
      icon: CalendarDays,
      label: 'Kaynak güncellemesi',
      value: details.updatedAt ? formatEventDate(details.updatedAt) : null,
    },
  ].filter(row => Boolean(row.value));

  if (rows.length === 0) return null;
  return (
    <View style={styles.section}>
      <AppText variant="heading18">Kaynak detayları</AppText>
      <View style={styles.infoCard}>
        {rows.map((row, index) => (
          <View key={row.label}>
            {index > 0 ? <View style={styles.infoDivider} /> : null}
            <EventInfoRow
              icon={row.icon}
              label={row.label}
              value={row.value ?? ''}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

export function EventInfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Icon size={19} color={colors.brand} />
      </View>
      <View style={styles.infoText}>
        <AppText variant="tiny11" tone="secondary">
          {label}
        </AppText>
        <AppText variant="label14">{value}</AppText>
      </View>
    </View>
  );
}

function sourceToken(value: string): string {
  const token = value.split('/').at(-1) ?? value;
  const labels: Record<string, string> = {
    EventScheduled: 'Planlandı',
    EventCancelled: 'İptal edildi',
    EventPostponed: 'Ertelendi',
    EventRescheduled: 'Tarihi değişti',
    OfflineEventAttendanceMode: 'Yüz yüze',
    OnlineEventAttendanceMode: 'Çevrim içi',
    MixedEventAttendanceMode: 'Hibrit',
    InStock: 'Bilet mevcut',
    SoldOut: 'Tükendi',
    PreOrder: 'Ön satışta',
  };
  return labels[token] ?? token.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function durationLabel(value: string): string {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/i);
  if (!match) return value;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  return [hours ? `${hours} saat` : '', minutes ? `${minutes} dakika` : '']
    .filter(Boolean)
    .join(' ');
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  infoCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSoft,
    padding: spacing.md,
    gap: spacing.sm,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  infoIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoText: { flex: 1, gap: 2 },
  infoDivider: { height: 1, marginLeft: 50, backgroundColor: colors.border },
});
