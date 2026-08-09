import type { ProfileStackParamList } from '@app/navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppButton,
  AppText,
  ErrorState,
  IconButton,
  RefreshableContent,
  Screen,
  Skeleton,
  StateView,
} from '@shared/components';
import { toAppError } from '@shared/lib/errors';
import { getSignedProfilePhotoUrls } from '@shared/lib/profilePhotoUrls';
import { supabase } from '@shared/lib/supabase';
import { colors, radius, spacing } from '@shared/theme';
import { FlashList } from '@shopify/flash-list';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react-native';
import { Alert, Image, RefreshControl, StyleSheet, View } from 'react-native';

type Props = NativeStackScreenProps<ProfileStackParamList, 'BlockedUsers'>;
type Blocked = {
  id: string;
  name: string;
  username: string;
  photo: string | null;
};

type BlockedUserRow = {
  id: string;
  full_name: string | null;
  username: string | null;
  primary_photo_path: string | null;
  blocked_at: string;
};

export function BlockedUsersScreen({ navigation }: Props) {
  const queryClient = useQueryClient();
  const blocked = useQuery({
    queryKey: ['blocked-users'],
    queryFn: async (): Promise<Blocked[]> => {
      const { data, error: blockError } = await supabase.rpc(
        'list_blocked_users',
      );
      if (blockError) throw blockError;
      const rows = data as BlockedUserRow[];
      const signedUrls = await getSignedProfilePhotoUrls(
        rows.flatMap(row =>
          row.primary_photo_path ? [row.primary_photo_path] : [],
        ),
      );
      return rows.map(row => ({
        id: row.id,
        name: row.full_name ?? 'EtkinLink kullanıcısı',
        username: row.username ?? 'kullanici',
        photo: row.primary_photo_path
          ? signedUrls.get(row.primary_photo_path) ?? null
          : null,
      }));
    },
  });
  const unblock = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc('unblock_user', {
        target_user_id: userId,
      });
      if (error) throw error;
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['blocked-users'] }),
  });
  if (blocked.isLoading)
    return (
      <Screen contentStyle={styles.screen}>
        <Skeleton style={styles.row} />
        <Skeleton style={styles.row} />
      </Screen>
    );
  if (blocked.isError)
    return (
      <Screen contentStyle={styles.screen}>
        <RefreshableContent
          refreshing={blocked.isRefetching}
          onRefresh={() => void blocked.refetch()}
        >
          <ErrorState
            title="Engellenenler yüklenemedi"
            description={toAppError(blocked.error).message}
            actionLabel="Tekrar dene"
            onAction={() => void blocked.refetch()}
          />
        </RefreshableContent>
      </Screen>
    );
  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.header}>
        <IconButton
          icon={ArrowLeft}
          label="Geri"
          onPress={navigation.goBack}
          style={styles.headerButton}
        />
        <AppText variant="heading20">Engellenenler</AppText>
        <View style={styles.spacer} />
      </View>
      {blocked.data?.length ? (
        <FlashList
          data={blocked.data}
          keyExtractor={item => item.id}
          refreshControl={
            <RefreshControl
              refreshing={blocked.isRefetching}
              onRefresh={() => void blocked.refetch()}
              tintColor={colors.brand}
              colors={[colors.brand]}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              {item.photo ? (
                <Image source={{ uri: item.photo }} style={styles.avatar} />
              ) : (
                <View style={styles.avatar} />
              )}
              <View style={styles.info}>
                <AppText variant="label15">{item.name}</AppText>
                <AppText variant="caption12" tone="secondary">
                  @{item.username}
                </AppText>
              </View>
              <AppButton
                label="Engeli kaldır"
                variant="secondary"
                fullWidth={false}
                disabled={unblock.isPending}
                onPress={() =>
                  Alert.alert(
                    'Engeli kaldır',
                    `${item.name} için engel kaldırılsın mı? Önceki eşleşme otomatik açılmaz.`,
                    [
                      { text: 'Vazgeç', style: 'cancel' },
                      {
                        text: 'Engeli kaldır',
                        onPress: () => unblock.mutate(item.id),
                      },
                    ],
                  )
                }
              />
            </View>
          )}
        />
      ) : (
        <RefreshableContent
          refreshing={blocked.isRefetching}
          onRefresh={() => void blocked.refetch()}
        >
          <StateView
            title="Engellenen kullanıcı yok"
            description="Engellediğin kişiler burada görünür."
          />
        </RefreshableContent>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.md, gap: spacing.md },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  spacer: { width: 48 },
  headerButton: { borderWidth: 0, backgroundColor: colors.transparent },
  row: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceMuted,
  },
  info: { flex: 1 },
});
