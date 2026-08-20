import { EventImage } from '@features/events/EventImage';
import { AppText, IconButton } from '@shared/components';
import { colors, radius, shadows, spacing } from '@shared/theme';
import type {
  CompatibilityDimension,
  CompatibilityEvent,
  CompatibilitySnapshot,
  MatchContext,
} from '@shared/types/domain';
import {
  CalendarCheck2,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  HeartHandshake,
  Sparkles,
  X,
} from 'lucide-react-native';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

type Props = {
  compatibility: CompatibilitySnapshot;
  matchContext?: MatchContext | null;
  onOpenEvent?: (eventId: string) => void;
  compact?: boolean;
};

type Section = 'interests' | 'upcoming' | 'attended';

export function CompatibilityCard({
  compatibility,
  matchContext,
  onOpenEvent,
  compact = false,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState<Section | null>(null);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Uyum oranı yüzde ${compatibility.score}. Ayrıntıları aç`}
        onPress={() => setVisible(true)}
        style={({ pressed }) => [
          styles.card,
          compact && styles.cardCompact,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.titleRow}>
          <View style={styles.titleLeft}>
            <HeartHandshake size={compact ? 17 : 20} color={colors.brand} />
            <AppText variant={compact ? 'label14' : 'label15'}>
              Genel uyum
            </AppText>
          </View>
          <AppText variant={compact ? 'label15' : 'heading20'} tone="brand">
            %{compatibility.score}
          </AppText>
        </View>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${Math.max(0, Math.min(100, compatibility.score))}%` },
            ]}
          />
        </View>
        <View
          style={[styles.summaryGrid, compact && styles.summaryGridCompact]}
        >
          <SummaryMetric
            label="Ortak ilgi"
            value={compatibility.interests.commonCount}
            score={compatibility.interests.score}
          />
          <SummaryMetric
            label="Katılacak"
            value={compatibility.upcoming.commonCount}
            score={compatibility.upcoming.score}
          />
          <SummaryMetric
            label="Katıldığın"
            value={compatibility.attended.commonCount}
            score={compatibility.attended.score}
          />
        </View>
      </Pressable>

      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeading}>
                <Sparkles size={22} color={colors.brand} />
                <View>
                  <AppText variant="heading20">Uyum detayları</AppText>
                  <AppText variant="caption12" tone="secondary">
                    Eşleşme için ortak noktalarınız
                  </AppText>
                </View>
              </View>
              <IconButton
                icon={X}
                label="Uyum detaylarını kapat"
                onPress={() => setVisible(false)}
              />
            </View>
            <ScrollView contentContainerStyle={styles.sheetContent}>
              <View style={styles.scoreHero}>
                <AppText variant="heading24" tone="brand">
                  %{compatibility.score}
                </AppText>
                <AppText variant="label14">Genel uyum oranı</AppText>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.fill,
                      {
                        width: `${Math.max(
                          0,
                          Math.min(100, compatibility.score),
                        )}%`,
                      },
                    ]}
                  />
                </View>
              </View>

              {matchContext ? <MatchFacts context={matchContext} /> : null}

              <DimensionRow
                section="interests"
                label="Ortak ilgi alanları"
                icon={Sparkles}
                dimension={compatibility.interests}
                expanded={expanded === 'interests'}
                onToggle={() =>
                  setExpanded(value =>
                    value === 'interests' ? null : 'interests',
                  )
                }
              >
                <View style={styles.chips}>
                  {compatibility.interests.items.map(item => (
                    <View key={item.id} style={styles.chip}>
                      <AppText variant="caption12" tone="brand">
                        {item.label}
                      </AppText>
                    </View>
                  ))}
                </View>
              </DimensionRow>
              <DimensionRow
                section="upcoming"
                label="Ortak katılacaklarınız"
                icon={CalendarClock}
                dimension={compatibility.upcoming}
                expanded={expanded === 'upcoming'}
                onToggle={() =>
                  setExpanded(value =>
                    value === 'upcoming' ? null : 'upcoming',
                  )
                }
              >
                <EventList
                  events={compatibility.upcoming.items}
                  onOpenEvent={onOpenEvent}
                />
              </DimensionRow>
              <DimensionRow
                section="attended"
                label="Ortak katıldıklarınız"
                icon={CalendarCheck2}
                dimension={compatibility.attended}
                expanded={expanded === 'attended'}
                onToggle={() =>
                  setExpanded(value =>
                    value === 'attended' ? null : 'attended',
                  )
                }
              >
                <EventList
                  events={compatibility.attended.items}
                  onOpenEvent={onOpenEvent}
                />
              </DimensionRow>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function SummaryMetric({
  label,
  value,
  score,
}: {
  label: string;
  value: number;
  score: number;
}) {
  return (
    <View style={styles.summaryMetric}>
      <AppText variant="label14">{value}</AppText>
      <AppText variant="tiny11" tone="secondary" numberOfLines={1}>
        {label}
      </AppText>
      <AppText variant="tiny11" tone="brand">
        %{score}
      </AppText>
    </View>
  );
}

function MatchFacts({ context }: { context: MatchContext }) {
  return (
    <View style={styles.facts}>
      <AppText variant="label15">Eşleşme anındaki bilgiler</AppText>
      <Fact
        label="İlk beğenen"
        value={context.firstLiker.name ?? 'Bilinmiyor'}
      />
      <Fact
        label="Eşleşmeyi tamamlayan"
        value={context.acceptedBy.name ?? 'Bilinmiyor'}
      />
      <Fact label="Eşleşilen etkinlik" value={context.event.title} />
      <Fact
        label="Eşleşme zamanı"
        value={new Date(context.matchedAt).toLocaleString('tr-TR', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}
      />
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.factRow}>
      <AppText variant="caption12" tone="secondary">
        {label}
      </AppText>
      <AppText variant="label14" style={styles.factValue}>
        {value}
      </AppText>
    </View>
  );
}

function DimensionRow({
  label,
  icon: Icon,
  dimension,
  expanded,
  onToggle,
  children,
}: {
  section: Section;
  label: string;
  icon: typeof Sparkles;
  dimension: CompatibilityDimension<unknown>;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.dimensionCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${label}, ${dimension.commonCount} ortak, yüzde ${dimension.score}`}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.dimensionRow,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.dimensionIcon}>
          <Icon size={20} color={colors.brand} />
        </View>
        <View style={styles.dimensionText}>
          <AppText variant="label15">{label}</AppText>
          <AppText variant="caption12" tone="secondary">
            {dimension.commonCount} ortak · Sen {dimension.myCount} · O{' '}
            {dimension.theirCount}
          </AppText>
        </View>
        <AppText variant="label14" tone="brand">
          %{dimension.score}
        </AppText>
        {expanded ? (
          <ChevronUp size={18} color={colors.textSecondary} />
        ) : (
          <ChevronDown size={18} color={colors.textSecondary} />
        )}
      </Pressable>
      {expanded ? (
        <View style={styles.expanded}>
          {dimension.commonCount > 0 ? (
            children
          ) : (
            <AppText variant="caption12" tone="secondary" align="center">
              Bu başlıkta henüz ortak kayıt yok.
            </AppText>
          )}
        </View>
      ) : null}
    </View>
  );
}

function EventList({
  events,
  onOpenEvent,
}: {
  events: CompatibilityEvent[];
  onOpenEvent?: (eventId: string) => void;
}) {
  return (
    <View style={styles.eventList}>
      {events.map(event => (
        <Pressable
          key={event.id}
          accessibilityRole={onOpenEvent ? 'button' : undefined}
          accessibilityLabel={`${event.title} etkinliğini aç`}
          disabled={!onOpenEvent}
          onPress={() => onOpenEvent?.(event.id)}
          style={({ pressed }) => [styles.eventRow, pressed && styles.pressed]}
        >
          <EventImage
            imageUrl={event.imageUrl}
            style={styles.eventImage}
            iconSize={18}
          />
          <View style={styles.eventText}>
            <AppText variant="label14" numberOfLines={2}>
              {event.title}
            </AppText>
            {event.startAt ? (
              <AppText variant="tiny11" tone="secondary">
                {new Date(event.startAt).toLocaleDateString('tr-TR', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </AppText>
            ) : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    ...shadows.card,
    marginHorizontal: spacing.md,
    padding: spacing.md,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  cardCompact: { marginHorizontal: spacing.md, paddingVertical: spacing.sm },
  pressed: { opacity: 0.72 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  titleLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  track: {
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.brandSoft,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.full,
    backgroundColor: colors.brand,
  },
  summaryGrid: { flexDirection: 'row', gap: spacing.xs },
  summaryGridCompact: { marginTop: 2 },
  summaryMetric: {
    flex: 1,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 4,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    backgroundColor: colors.canvas,
    overflow: 'hidden',
  },
  sheetHeader: {
    minHeight: 60,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sheetContent: {
    padding: spacing.md,
    gap: spacing.sm,
    paddingBottom: spacing.xl,
  },
  scoreHero: {
    padding: spacing.lg,
    gap: spacing.xs,
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.brandSoft,
  },
  facts: {
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  factRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  factValue: { flex: 1, textAlign: 'right' },
  dimensionCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  dimensionRow: {
    minHeight: 56,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dimensionIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  dimensionText: { flex: 1, gap: 2 },
  expanded: {
    padding: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.brandSoft,
  },
  eventList: { gap: spacing.xs },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  eventImage: { width: 48, height: 48, borderRadius: radius.sm },
  eventText: { flex: 1, gap: 2 },
});
