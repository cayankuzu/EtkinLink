import type { ProfileStackParamList } from '@app/navigation/types';
import { useSessionStore } from '@features/auth/sessionStore';
import { setMatchingEnabled } from '@features/matching/matchingService';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppButton,
  AppText,
  IconButton,
  Screen,
  TextField,
} from '@shared/components';
import { contentLimits } from '@shared/constants/limits';
import { toAppError } from '@shared/lib/errors';
import { enablePushNotifications } from '@shared/lib/pushNotifications';
import { queryKeys } from '@shared/lib/queryKeys';
import { supabase } from '@shared/lib/supabase';
import { colors, layout, radius, spacing } from '@shared/theme';
import type { Profile } from '@shared/types/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BellRing,
  ChevronRight,
  Eye,
  FileText,
  HeartHandshake,
  KeyRound,
  LockKeyhole,
  LogOut,
  SlidersHorizontal,
  Trash2,
  UserPen,
} from 'lucide-react-native';
import type { ComponentType } from 'react';
import { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  View,
} from 'react-native';

import { getProfile } from './profileService';

type Props = NativeStackScreenProps<ProfileStackParamList, 'Settings'>;

export function SettingsScreen({ navigation }: Props) {
  const queryClient = useQueryClient();
  const signOut = useSessionStore(state => state.signOut);
  const userId = useSessionStore(state => state.session?.user.id ?? null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const profile = useQuery({
    queryKey: queryKeys.profile.settings,
    queryFn: () => getProfile(),
    staleTime: 30_000,
  });
  const matchingMode = useMutation({
    mutationFn: (enabled: boolean) => setMatchingEnabled(enabled),
    onMutate: enabled => {
      const previous = queryClient.getQueryData<Profile>(
        queryKeys.profile.settings,
      );
      queryClient.setQueryData<Profile>(queryKeys.profile.settings, current =>
        current ? { ...current, matchingEnabled: enabled } : current,
      );
      return { previous };
    },
    onError: (_error, _enabled, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.profile.settings, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.profile.settings,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile.all });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.matching.settings(),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.matching.candidates(),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.rooms.all });
    },
  });

  function confirmSignOut() {
    Alert.alert(
      'Çıkış yap',
      'Bu cihazdaki oturumun kapatılacak. Devam edilsin mi?',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Çıkış yap',
          style: 'destructive',
          onPress: () => void signOut(),
        },
      ],
    );
  }

  async function enableNotifications() {
    if (!userId || notificationBusy) return;
    setNotificationBusy(true);
    try {
      const enabled = await enablePushNotifications(userId);
      Alert.alert(
        enabled ? 'Bildirimler açıldı' : 'Bildirim izni verilmedi',
        enabled
          ? 'Mesaj, eşleşme ve etkinlik hatırlatmalarını bu cihazda alacaksın.'
          : 'İzni daha sonra cihaz ayarlarından açabilirsin.',
      );
    } catch (notificationError) {
      Alert.alert(
        'Bildirimler açılamadı',
        toAppError(notificationError).message,
      );
    } finally {
      setNotificationBusy(false);
    }
  }

  async function deleteAccount() {
    if (confirmation !== 'SİL') return;
    setBusy(true);
    setError(null);
    const { error: deleteError } = await supabase.functions.invoke(
      'delete-account',
      { method: 'POST' },
    );
    if (deleteError) {
      setBusy(false);
      let message = toAppError(deleteError).message;
      const context =
        typeof deleteError === 'object' &&
        deleteError &&
        'context' in deleteError &&
        deleteError.context instanceof Response
          ? deleteError.context
          : null;
      if (context) {
        try {
          const payload = (await context.clone().json()) as { error?: unknown };
          if (typeof payload.error === 'string') message = payload.error;
        } catch {
          // Keep the normalized, user-safe fallback.
        }
      }
      setError(message);
      return;
    }
    await signOut();
    setBusy(false);
  }

  return (
    <Screen scroll contentStyle={styles.screen}>
      <View style={styles.header}>
        <IconButton
          icon={ArrowLeft}
          label="Geri"
          onPress={navigation.goBack}
          style={styles.headerButton}
        />
        <AppText variant="heading20" style={styles.headerTitle}>
          Ayarlar
        </AppText>
        <View style={styles.spacer} />
      </View>

      <SettingsGroup title="PROFİL">
        <SettingRow
          icon={UserPen}
          title="Profili Düzenle"
          onPress={() => navigation.navigate('EditProfile')}
        />
        <SettingRow
          icon={Eye}
          title="Profil Görünürlüğü"
          onPress={() => navigation.navigate('ProfileVisibility')}
        />
        <SettingToggleRow
          icon={HeartHandshake}
          title="Eşleşme Durumu"
          description={
            profile.data?.matchingEnabled
              ? 'Eşleşme modun açık. Katıldığın etkinliklerde uygun adaylara görünürsün.'
              : 'Eşleşme modun kapalı. Aday kartlarında görünmezsin.'
          }
          value={profile.data?.matchingEnabled ?? false}
          disabled={profile.isLoading || matchingMode.isPending}
          onChange={enabled => matchingMode.mutate(enabled)}
        />
        <SettingRow
          icon={SlidersHorizontal}
          title="Eşleşme Filtreleri"
          onPress={() => navigation.navigate('MatchFilters')}
        />
        <SettingRow
          icon={KeyRound}
          title="Şifreyi Yenile"
          onPress={() => navigation.navigate('ChangePassword')}
          last
        />
      </SettingsGroup>
      {profile.isError || matchingMode.error ? (
        <AppText variant="caption12" tone="danger" accessibilityRole="alert">
          {toAppError(profile.error ?? matchingMode.error).message}
        </AppText>
      ) : null}

      <SettingsGroup title="GÜVENLİK VE DESTEK">
        <SettingRow
          icon={BellRing}
          title={notificationBusy ? 'Bildirimler açılıyor…' : 'Bildirimleri Aç'}
          onPress={() => void enableNotifications()}
        />
        <SettingRow
          icon={LockKeyhole}
          title="Engellenen Kullanıcılar"
          onPress={() => navigation.navigate('BlockedUsers')}
        />
        <SettingRow
          icon={FileText}
          title="Hakkında ve Yasal"
          onPress={() => navigation.navigate('AboutLegal')}
          last
        />
      </SettingsGroup>

      <SettingsGroup title="HESAP İŞLEMLERİ">
        <SettingRow
          icon={LogOut}
          title="Çıkış Yap"
          danger
          onPress={confirmSignOut}
        />
        <SettingRow
          icon={Trash2}
          title="Hesabı Sil"
          danger
          onPress={() => setDeleteOpen(true)}
          last
        />
      </SettingsGroup>

      <Modal
        visible={deleteOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.modal} accessibilityViewIsModal>
            <AppText variant="heading20">Hesabı kalıcı olarak sil</AppText>
            <AppText variant="body14" tone="secondary">
              Profilin, fotoğrafların, mesajların, eşleşmelerin ve etkinlik
              katılımların kalıcı olarak silinir. Bu işlem geri alınamaz.
            </AppText>
            <TextField
              label="Onaylamak için SİL yaz"
              value={confirmation}
              maxLength={contentLimits.deleteConfirmation}
              autoCapitalize="characters"
              onChangeText={setConfirmation}
            />
            {error ? (
              <AppText variant="caption12" tone="danger">
                {error}
              </AppText>
            ) : null}
            <AppButton
              label="Hesabımı kalıcı olarak sil"
              variant="danger"
              loading={busy}
              disabled={confirmation !== 'SİL'}
              onPress={() => void deleteAccount()}
            />
            <AppButton
              label="Vazgeç"
              variant="ghost"
              onPress={() => {
                setDeleteOpen(false);
                setConfirmation('');
                setError(null);
              }}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.group}>
      <AppText variant="tiny11" tone="secondary">
        {title}
      </AppText>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function SettingRow({
  icon: Icon,
  title,
  onPress,
  danger = false,
  last = false,
}: {
  icon: ComponentType<{ size?: number; color?: string }>;
  title: string;
  onPress: () => void;
  danger?: boolean;
  last?: boolean;
}) {
  const color = danger ? colors.danger : colors.textSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && styles.rowBorder,
        pressed && styles.pressed,
      ]}
    >
      <Icon size={21} color={color} />
      <AppText
        variant="label15"
        tone={danger ? 'danger' : 'primary'}
        style={styles.rowTitle}
      >
        {title}
      </AppText>
      <ChevronRight size={21} color={colors.textSecondary} />
    </Pressable>
  );
}

function SettingToggleRow({
  icon: Icon,
  title,
  description,
  value,
  disabled,
  onChange,
  last = false,
}: {
  icon: ComponentType<{ size?: number; color?: string }>;
  title: string;
  description: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  last?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, !last && styles.rowBorder]}>
      <Icon size={21} color={colors.textSecondary} />
      <View style={styles.toggleText}>
        <AppText variant="label15">{title}</AppText>
        <AppText variant="caption12" tone="secondary">
          {description}
        </AppText>
      </View>
      <Switch
        accessibilityLabel={title}
        accessibilityState={{ checked: value, disabled }}
        value={value}
        disabled={disabled}
        trackColor={{ false: colors.borderStrong, true: colors.brandSoft }}
        thumbColor={value ? colors.brand : colors.surface}
        ios_backgroundColor={colors.borderStrong}
        onValueChange={onChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.md, gap: spacing.md },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerButton: { borderWidth: 0, backgroundColor: colors.transparent },
  headerTitle: { marginLeft: spacing.sm },
  spacer: { flex: 1 },
  group: { gap: spacing.xs },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowTitle: { flex: 1 },
  toggleRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  toggleText: { flex: 1, gap: spacing.xxs },
  pressed: { opacity: 0.68 },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  modal: {
    width: '100%',
    maxWidth: layout.maxModalWidth,
    maxHeight: '92%',
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    padding: spacing.xl,
    gap: spacing.md,
  },
});
