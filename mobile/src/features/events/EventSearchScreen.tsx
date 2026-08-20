import type { DiscoverStackParamList } from '@app/navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppText,
  ErrorState,
  IconButton,
  RefreshableContent,
  Screen,
  StateView,
} from '@shared/components';
import { contentLimits } from '@shared/constants/limits';
import { toAppError } from '@shared/lib/errors';
import { queryKeys } from '@shared/lib/queryKeys';
import { colors, layout, radius, spacing, typography } from '@shared/theme';
import type { Event } from '@shared/types/domain';
import { FlashList } from '@shopify/flash-list';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Search, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, TextInput, View } from 'react-native';

import { EventCard } from './EventCard';
import {
  clearEventFeedCache,
  filterUniversalEventSearch,
  loadUniversalEventSearchBroadIndex,
  loadUniversalEventSearchIndex,
  loadUniversalEventSearchPreview,
  setEventSaved,
} from './eventService';

type Props = NativeStackScreenProps<DiscoverStackParamList, 'EventSearch'>;
const emptyEvents: Event[] = [];

export function EventSearchScreen({ navigation }: Props) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim();
  const preview = useQuery({
    queryKey: queryKeys.events.searchIndexFor('preview'),
    queryFn: loadUniversalEventSearchPreview,
    staleTime: 10 * 60 * 1000,
  });
  const completeIndex = useQuery({
    queryKey: queryKeys.events.searchIndexFor('complete'),
    queryFn: loadUniversalEventSearchIndex,
    staleTime: 10 * 60 * 1000,
  });
  const broadIndex = useQuery({
    queryKey: queryKeys.events.searchIndexFor('broad'),
    queryFn: loadUniversalEventSearchBroadIndex,
    staleTime: 10 * 60 * 1000,
  });
  const sourceEvents =
    completeIndex.data ?? broadIndex.data ?? preview.data ?? emptyEvents;
  const items = useMemo(
    () => filterUniversalEventSearch(sourceEvents, normalizedQuery),
    [normalizedQuery, sourceEvents],
  );
  const isRefreshing =
    preview.isRefetching ||
    broadIndex.isRefetching ||
    completeIndex.isRefetching;
  const isSearchingTurkey = !completeIndex.data && completeIndex.isFetching;
  const searchError = completeIndex.error ?? broadIndex.error ?? preview.error;

  function refreshSearchIndex() {
    clearEventFeedCache();
    void Promise.all([
      preview.refetch(),
      broadIndex.refetch(),
      completeIndex.refetch(),
    ]);
  }

  const save = useMutation({
    mutationFn: ({ event, saved }: { event: Event; saved: boolean }) =>
      setEventSaved(event, saved),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.events.searchIndex,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.events.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.events.saved });
    },
  });
  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} label="Geri" onPress={navigation.goBack} />
        <View style={styles.searchBox}>
          <Search size={20} color={colors.textTertiary} />
          <TextInput
            autoFocus
            accessibilityLabel="Etkinlik ara"
            value={query}
            onChangeText={setQuery}
            placeholder="Etkinlik, mekân veya şehir"
            placeholderTextColor={colors.textTertiary}
            maxLength={contentLimits.eventSearch}
            returnKeyType="search"
            style={styles.input}
          />
          {query ? (
            <IconButton
              icon={X}
              label="Aramayı temizle"
              onPress={() => setQuery('')}
              style={styles.clear}
            />
          ) : null}
        </View>
      </View>
      <View style={styles.searchMeta}>
        <AppText variant="caption12" tone="secondary">
          Türkiye geneli · tüm şehirler · tüm tarihler
        </AppText>
        <AppText variant="caption12" tone="tertiary">
          {query.length}/80
        </AppText>
      </View>
      {normalizedQuery.length < 2 ? (
        <StateView
          title="Etkinlik ara"
          description="Türkiye'deki tüm etkinliklerde ad, mekân veya şehirden en az 2 karakter yaz."
        />
      ) : preview.isError && broadIndex.isError && completeIndex.isError ? (
        <RefreshableContent
          refreshing={isRefreshing}
          onRefresh={refreshSearchIndex}
        >
          <ErrorState
            title="Arama yapılamadı"
            description={toAppError(searchError).message}
            actionLabel="Tekrar dene"
            onAction={refreshSearchIndex}
          />
        </RefreshableContent>
      ) : items.length === 0 && isSearchingTurkey ? (
        <StateView
          title="Türkiye genelinde aranıyor"
          description="İlk sonuçlar hazırlanıyor; tüm şehir ve tarih akışları taranıyor."
        />
      ) : items.length === 0 ? (
        <RefreshableContent
          refreshing={isRefreshing}
          onRefresh={refreshSearchIndex}
        >
          <StateView
            title="Sonuç bulunamadı"
            description="Yazımı veya arama kelimeni değiştirip tekrar dene."
          />
        </RefreshableContent>
      ) : (
        <FlashList
          data={items}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={refreshSearchIndex}
              tintColor={colors.brand}
              colors={[colors.brand]}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.item}>
              <EventCard
                event={item}
                type="standard"
                onPress={() =>
                  navigation.navigate('EventDetail', { eventId: item.id })
                }
                onToggleSaved={() =>
                  save.mutate({ event: item, saved: !item.saved })
                }
              />
            </View>
          )}
          ListFooterComponent={
            isSearchingTurkey ? (
              <AppText
                variant="caption12"
                tone="secondary"
                style={styles.indexing}
              >
                Diğer şehir ve tarihler arka planda taranıyor…
              </AppText>
            ) : null
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.md,
  },
  searchBox: {
    flex: 1,
    minHeight: layout.touchTarget,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.md,
  },
  input: {
    ...typography.body15,
    flex: 1,
    color: colors.textPrimary,
    minHeight: layout.touchTarget,
    paddingVertical: spacing.xs,
  },
  clear: { width: 44, height: 44, borderWidth: 0 },
  searchMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginTop: -spacing.sm,
  },
  list: { paddingVertical: spacing.md },
  item: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  indexing: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    textAlign: 'center',
  },
});
