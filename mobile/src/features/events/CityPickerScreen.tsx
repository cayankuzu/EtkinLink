import type { DiscoverStackParamList } from '@app/navigation/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppText, IconButton, Screen, StateView } from '@shared/components';
import {
  normalizeTurkishSearch,
  TURKISH_CITIES,
} from '@shared/constants/cities';
import { contentLimits } from '@shared/constants/limits';
import { colors, layout, radius, spacing, typography } from '@shared/theme';
import { FlashList } from '@shopify/flash-list';
import { ArrowLeft, Check, Search, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useEventFilterStore } from './eventFilterStore';

type Props = NativeStackScreenProps<DiscoverStackParamList, 'CityPicker'>;

export function CityPickerScreen({ navigation }: Props) {
  const city = useEventFilterStore(state => state.city);
  const setFilters = useEventFilterStore(state => state.setFilters);
  const [query, setQuery] = useState('');
  const cities = useMemo(() => {
    const term = normalizeTurkishSearch(query.trim());
    return term
      ? TURKISH_CITIES.filter(item =>
          normalizeTurkishSearch(item).includes(term),
        )
      : TURKISH_CITIES;
  }, [query]);

  function select(nextCity: string | null) {
    setFilters({ city: nextCity });
    navigation.goBack();
  }

  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} label="Geri" onPress={navigation.goBack} />
        <AppText variant="heading20">Şehir Seç</AppText>
        <View style={styles.spacer} />
      </View>

      <View style={styles.searchBox}>
        <Search size={20} color={colors.textTertiary} />
        <TextInput
          autoFocus
          accessibilityLabel="Şehir ara"
          value={query}
          onChangeText={setQuery}
          placeholder="Şehir ara"
          placeholderTextColor={colors.textTertiary}
          maxLength={contentLimits.citySearch}
          autoCapitalize="words"
          autoCorrect={false}
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

      <FlashList
        data={cities}
        keyExtractor={item => item}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          !query ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: city === null }}
              onPress={() => select(null)}
              style={({ pressed }) => [
                styles.city,
                city === null && styles.citySelected,
                pressed && styles.pressed,
              ]}
            >
              <AppText variant="label15">Tüm şehirler</AppText>
              {city === null ? <Check size={20} color={colors.brand} /> : null}
            </Pressable>
          ) : null
        }
        ListEmptyComponent={
          <StateView
            title="Şehir bulunamadı"
            description="Yazımını kontrol edip tekrar deneyebilirsin."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item} şehrini seç`}
            accessibilityState={{ selected: city === item }}
            onPress={() => select(item)}
            style={({ pressed }) => [
              styles.city,
              city === item && styles.citySelected,
              pressed && styles.pressed,
            ]}
          >
            <AppText variant={city === item ? 'label15' : 'body15'}>
              {item}
            </AppText>
            {city === item ? <Check size={20} color={colors.brand} /> : null}
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  header: {
    height: layout.headerHeight,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  spacer: { width: layout.touchTarget },
  searchBox: {
    minHeight: layout.touchTarget,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    paddingLeft: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  input: {
    ...typography.body15,
    flex: 1,
    minHeight: layout.touchTarget,
    color: colors.textPrimary,
  },
  clear: { width: 44, height: 44, borderWidth: 0 },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  city: {
    minHeight: 48,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  citySelected: { backgroundColor: colors.brandSubtle },
  pressed: { opacity: 0.7 },
});
