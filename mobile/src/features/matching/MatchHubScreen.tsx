import type { RoomsStackParamList } from '@app/navigation/types';
import { getEvent } from '@features/events/eventService';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppButton,
  AppText,
  ErrorState,
  IconButton,
  Screen,
} from '@shared/components';
import { premiumComingSoonMessage } from '@shared/constants/premium';
import { toAppError } from '@shared/lib/errors';
import { colors, radius, spacing } from '@shared/theme';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleCheck,
  Crown,
  Images,
  MessageCircle,
  Tags,
  UserRoundCheck,
  X,
} from 'lucide-react-native';
import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';

import { getMatchingSettings, setMatchingEnabled } from './matchingService';

type Props = NativeStackScreenProps<RoomsStackParamList, 'MatchHub'>;

export function MatchHubScreen({ route, navigation }: Props) {
  const queryClient = useQueryClient();
  const [activated, setActivated] = useState(false);
  const event = useQuery({
    queryKey: ['event', route.params.eventId],
    queryFn: () => getEvent(route.params.eventId),
  });
  const settings = useQuery({
    queryKey: ['matching-settings', route.params.eventId],
    queryFn: () => getMatchingSettings(route.params.eventId),
  });
  const activation = useMutation({
    mutationFn: () => setMatchingEnabled(true),
    onSuccess: () => {
      setActivated(true);
      void queryClient.invalidateQueries({
        queryKey: ['matching-settings', route.params.eventId],
      });
    },
  });
  if (event.isError || settings.isError)
    return (
      <Screen>
        <ErrorState
          title="Eşleşme alanı açılamadı"
          description={toAppError(event.error ?? settings.error).message}
          actionLabel="Geri dön"
          onAction={navigation.goBack}
        />
      </Screen>
    );
  if (event.isLoading || settings.isLoading)
    return (
      <Screen contentStyle={styles.loadingScreen}>
        <View style={styles.loadingBlock} />
        <View style={styles.loadingCard} />
      </Screen>
    );
  if (!event.data || !settings.data) return null;
  if (!settings.data.profileReady) {
    const completed = [
      settings.data.photoCount >= 3,
      settings.data.hasBio,
      settings.data.interestCount >= 3,
    ].filter(Boolean).length;
    return (
      <Screen contentStyle={styles.incompleteScreen}>
        <View style={styles.incompleteHeader}>
          <IconButton
            icon={ArrowLeft}
            label="Geri"
            onPress={navigation.goBack}
          />
          <AppText variant="heading18">Eşleşme</AppText>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.eventChip}>
          <View style={styles.eventDot} />
          <AppText
            variant="caption12"
            style={styles.eventChipText}
            numberOfLines={1}
          >
            {event.data.title}
          </AppText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Etkinlik detayını aç"
          onPress={() =>
            navigation.navigate('EventDetail', {
              eventId: route.params.eventId,
            })
          }
          style={styles.incompleteEvent}
        >
          {event.data.imageUrl ? (
            <Image
              source={{ uri: event.data.imageUrl }}
              style={styles.eventThumb}
            />
          ) : (
            <View style={styles.eventThumb} />
          )}
          <View style={styles.incompleteEventText}>
            <AppText variant="label13" numberOfLines={1}>
              {event.data.title}
            </AppText>
            <AppText variant="caption12" tone="secondary" numberOfLines={1}>
              {event.data.categories[0] ?? 'Etkinlik'} ·{' '}
              {event.data.city ?? 'Türkiye'}
            </AppText>
          </View>
        </Pressable>
        <View style={styles.checklistCard}>
          <View style={styles.checklistHeading}>
            <AppText variant="heading18">Profilini tamamla</AppText>
            <AppText variant="caption12" tone="secondary">
              Eşleşmeye başlamak için aşağıdakileri tamamla
            </AppText>
          </View>
          <View style={styles.progressHeading}>
            <AppText variant="caption12" tone="brand">
              Eşleşme Hazırlığı
            </AppText>
            <AppText variant="caption12" tone="secondary">
              {completed}/3 Tamamlandı
            </AppText>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${(completed / 3) * 100}%` },
              ]}
            />
          </View>
          <View style={styles.checklistDivider} />
          <ProfileRequirement
            complete={settings.data.photoCount >= 3}
            label="En az 3 fotoğraf"
            value={`${settings.data.photoCount}/3 fotoğraf`}
          />
          <ProfileRequirement
            complete={settings.data.hasBio}
            label="Kısa biyografi"
            value={settings.data.hasBio ? 'Tamamlandı' : 'Eksik'}
          />
          <ProfileRequirement
            complete={settings.data.interestCount >= 3}
            label="İlgi alanı"
            value={`${settings.data.interestCount}/3 seçim`}
          />
        </View>
        <View style={styles.incompleteAction}>
          <AppButton
            label="Profili Tamamla"
            onPress={() =>
              navigation.navigate('MatchProfileEdit', {
                eventId: route.params.eventId,
              })
            }
          />
        </View>
      </Screen>
    );
  }
  const enabled =
    (settings.data?.globalEnabled ?? false) &&
    (settings.data?.eventEnabled ?? false);
  return (
    <Screen scroll contentStyle={styles.screen}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} label="Geri" onPress={navigation.goBack} />
        <AppText variant="heading20">Eşleşme</AppText>
        <View style={styles.spacer} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Etkinlik detayını aç"
        onPress={() =>
          navigation.navigate('EventDetail', { eventId: route.params.eventId })
        }
        style={styles.eventBar}
      >
        <AppText
          variant="label15"
          tone="inverse"
          numberOfLines={1}
          style={styles.eventText}
        >
          {event.data?.title ?? 'Etkinlik'}
        </AppText>
        <ChevronRight size={20} color={colors.textInverse} />
      </Pressable>
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <UserRoundCheck size={36} color={colors.brand} />
        </View>
        <AppText variant="heading24" align="center">
          Aynı etkinlikte tanış
        </AppText>
        <AppText tone="secondary" align="center">
          Yalnız bu etkinliğe katılan ve eşleşmeyi açan kişiler gösterilir.
          Karşılıklı beğenide özel sohbet açılır.
        </AppText>
      </View>
      <View style={styles.requirements}>
        <Requirement
          icon={<Images size={20} color={colors.success} />}
          text="En az 3 profil fotoğrafı"
        />
        <Requirement
          icon={<MessageCircle size={20} color={colors.success} />}
          text="Kısa biyografi"
        />
        <Requirement
          icon={<Tags size={20} color={colors.success} />}
          text="En az 3 ilgi alanı"
        />
      </View>
      <View style={styles.activationCard}>
        <View style={styles.activationText}>
          <AppText variant="label15">Tüm odalarda eşleşme</AppText>
          <AppText variant="caption12" tone="secondary">
            Ücretsiz planda eşleşme tüm katıldığın odalarda birlikte açılır.
          </AppText>
        </View>
        <AppText variant="caption12" tone={enabled ? 'success' : 'secondary'}>
          {enabled ? 'Açık' : 'Kapalı'}
        </AppText>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => (settings.data?.premium ? undefined : undefined)}
        style={styles.premiumRow}
      >
        <Crown size={20} color={colors.warning} />
        <View style={styles.premiumText}>
          <AppText variant="label15">Yalnız bu odada aç</AppText>
          <AppText variant="caption12" tone="secondary">
            {premiumComingSoonMessage}
          </AppText>
        </View>
        <ChevronRight size={20} color={colors.textTertiary} />
      </Pressable>
      {activation.error ? (
        <AppText variant="caption12" tone="danger">
          {toAppError(activation.error).message}
        </AppText>
      ) : null}
      {!enabled ? (
        <AppButton
          label="Eşleşmeyi aktifleştir"
          loading={activation.isPending}
          onPress={() => activation.mutate()}
        />
      ) : (
        <AppButton
          label="Eşleşmeye başla"
          onPress={() =>
            navigation.navigate('MatchCards', { eventId: route.params.eventId })
          }
        />
      )}
      <AppButton
        label="Odaya dön"
        variant="ghost"
        onPress={navigation.goBack}
      />
      <Modal
        visible={activated}
        transparent
        animationType="fade"
        onRequestClose={() => setActivated(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.successIcon}>
              <Check size={26} color={colors.success} />
            </View>
            <AppText variant="heading20" align="center">
              Eşleşme açıldı
            </AppText>
            <AppText tone="secondary" align="center">
              Katıldığın tüm etkinlik odalarında eşleşme artık açık.
            </AppText>
            <AppButton
              label="Eşleşmeye başla"
              onPress={() => {
                setActivated(false);
                navigation.navigate('MatchCards', {
                  eventId: route.params.eventId,
                });
              }}
            />
            <AppButton
              label="Odaya dön"
              variant="ghost"
              onPress={() => setActivated(false)}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function ProfileRequirement({
  complete,
  label,
  value,
}: {
  complete: boolean;
  label: string;
  value: string;
}) {
  const Icon = complete ? CircleCheck : X;
  return (
    <View style={styles.profileRequirement}>
      <View
        style={[styles.profileStatus, !complete && styles.profileStatusMissing]}
      >
        <Icon size={14} color={complete ? colors.success : colors.danger} />
      </View>
      <AppText variant="body14" style={styles.profileRequirementLabel}>
        {label}
      </AppText>
      <View
        style={[
          styles.requirementBadge,
          !complete && styles.requirementBadgeMissing,
        ]}
      >
        <AppText variant="caption12" tone={complete ? 'success' : 'danger'}>
          {value}
        </AppText>
      </View>
    </View>
  );
}

function Requirement({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.requirement}>
      <View style={styles.check}>{icon}</View>
      <AppText variant="body14">{text}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingScreen: { padding: spacing.md, gap: spacing.md },
  loadingBlock: {
    height: 72,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
  },
  loadingCard: {
    height: 360,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
  },
  incompleteScreen: {
    backgroundColor: colors.canvas,
    padding: spacing.md,
    gap: spacing.md,
  },
  incompleteHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSpacer: { width: 48 },
  eventChip: {
    alignSelf: 'center',
    maxWidth: '78%',
    borderRadius: radius.full,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  eventDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  eventChipText: { color: colors.accent },
  incompleteEvent: {
    minHeight: 72,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  eventThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
  },
  incompleteEventText: { flex: 1, gap: 2 },
  checklistCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  checklistHeading: { gap: 4, marginBottom: spacing.xs },
  progressHeading: { flexDirection: 'row', justifyContent: 'space-between' },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: { height: 6, backgroundColor: colors.brand },
  checklistDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  profileRequirement: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  profileStatus: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileStatusMissing: { backgroundColor: colors.dangerSoft },
  profileRequirementLabel: { flex: 1 },
  requirementBadge: {
    borderRadius: 6,
    backgroundColor: colors.successSoft,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
  },
  requirementBadgeMissing: { backgroundColor: colors.dangerSoft },
  incompleteAction: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingTop: spacing.lg,
  },
  screen: { padding: spacing.md, gap: spacing.md },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  spacer: { width: 48 },
  eventBar: {
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  eventText: { flex: 1 },
  hero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  heroIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requirements: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.sm,
  },
  requirement: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  check: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activationCard: {
    minHeight: 76,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  activationText: { flex: 1, gap: spacing.xxs },
  premiumRow: {
    minHeight: 72,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  premiumText: { flex: 1 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    padding: spacing.xl,
    gap: spacing.md,
  },
  successIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
});
