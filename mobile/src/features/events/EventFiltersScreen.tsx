import type { DiscoverStackParamList } from '@app/navigation/types';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  AppButton,
  AppText,
  Chip,
  IconButton,
  Screen,
} from '@shared/components';
import { normalizeTurkishSearch } from '@shared/constants/cities';
import { queryKeys } from '@shared/lib/queryKeys';
import { colors, layout, radius, spacing, typography } from '@shared/theme';
import { useQuery } from '@tanstack/react-query';
import { format, isValid, parseISO } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronRight,
  MapPin,
  Search,
  X,
} from 'lucide-react-native';
import { useDeferredValue, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { DEFAULT_EVENT_CATEGORIES } from './eventCategories';
import {
  createDefaultEventDateFilter,
  useEventFilterStore,
} from './eventFilterStore';
import { listEventCategories } from './eventService';
import type { EventDateFilter, EventSort } from './eventTypes';

type Props = NativeStackScreenProps<DiscoverStackParamList, 'EventFilters'>;

const dateOptions: Array<{ value: EventDateFilter; label: string }> = [
  { value: 'all', label: 'Tüm tarihler' },
  { value: 'today', label: 'Bugün' },
  { value: 'weekend', label: 'Bu hafta sonu' },
];

const sortOptions: Array<{ value: EventSort; label: string }> = [
  { value: 'upcoming', label: 'En yakın tarih' },
  { value: 'newest', label: 'En ileri tarih' },
];

type DateRange = { start: Date; end: Date };
type DatePickerTarget = 'start' | 'end' | null;

function dateRangeFromFilter(filter: EventDateFilter): DateRange | null {
  if (!filter.startsWith('range:')) return null;
  const [startValue, endValue] = filter.slice('range:'.length).split(':');
  if (!startValue || !endValue) return null;
  const start = parseISO(startValue);
  const end = parseISO(endValue);
  return isValid(start) && isValid(end) && start <= end ? { start, end } : null;
}

function rangeFilterValue(range: DateRange): EventDateFilter {
  return `range:${format(range.start, 'yyyy-MM-dd')}:${format(
    range.end,
    'yyyy-MM-dd',
  )}`;
}

function uniqueCategoryLabels(values: string[]): string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    const key = normalizeTurkishSearch(value);
    if (key && !unique.has(key)) unique.set(key, value);
  }
  return [...unique.values()];
}

export function EventFiltersScreen({ navigation }: Props) {
  const city = useEventFilterStore(state => state.city);
  const storedCategories = useEventFilterStore(state => state.categories);
  const storedDate = useEventFilterStore(state => state.date);
  const storedSort = useEventFilterStore(state => state.sort);
  const setFilters = useEventFilterStore(state => state.setFilters);
  const resetFilters = useEventFilterStore(state => state.resetFilters);
  const [categories, setCategories] = useState(() =>
    uniqueCategoryLabels(storedCategories),
  );
  const [date, setDate] = useState(storedDate);
  const [dateRange, setDateRange] = useState<DateRange | null>(() =>
    dateRangeFromFilter(storedDate),
  );
  const [datePickerTarget, setDatePickerTarget] =
    useState<DatePickerTarget>(null);
  const [sort, setSort] = useState(storedSort);
  const [categoryQuery, setCategoryQuery] = useState('');
  const deferredCategoryQuery = useDeferredValue(categoryQuery.trim());
  const rangeSelected = date.startsWith('range:');
  const availableCategories = useQuery({
    queryKey: queryKeys.events.categories,
    queryFn: listEventCategories,
    staleTime: 5 * 60 * 1000,
  });
  const categoryOptions = useMemo(() => {
    const source = availableCategories.data?.length
      ? availableCategories.data
      : [...DEFAULT_EVENT_CATEGORIES];
    const selectedAndAvailable = uniqueCategoryLabels([
      ...categories,
      ...source,
    ]);
    const term = normalizeTurkishSearch(deferredCategoryQuery);
    return selectedAndAvailable.filter(
      category => !term || normalizeTurkishSearch(category).includes(term),
    );
  }, [availableCategories.data, categories, deferredCategoryQuery]);

  function toggleCategory(category: string) {
    const key = normalizeTurkishSearch(category);
    setCategories(current => {
      const selected = current.some(
        item => normalizeTurkishSearch(item) === key,
      );
      return selected
        ? current.filter(item => normalizeTurkishSearch(item) !== key)
        : [...current, category];
    });
  }

  function selectDatePreset(value: EventDateFilter) {
    setDate(value);
    setDateRange(null);
    setDatePickerTarget(null);
  }

  function selectRangeDate(
    target: Exclude<DatePickerTarget, null>,
    value: Date,
  ) {
    const nextRange =
      target === 'start'
        ? {
            start: value,
            end:
              dateRange?.end && dateRange.end >= value ? dateRange.end : value,
          }
        : {
            start:
              dateRange?.start && dateRange.start <= value
                ? dateRange.start
                : value,
            end: value,
          };
    setDateRange(nextRange);
    setDate(rangeFilterValue(nextRange));
  }

  function clearFilters() {
    const defaultDate = createDefaultEventDateFilter();
    resetFilters();
    setCategories([]);
    setDate(defaultDate);
    setDateRange(dateRangeFromFilter(defaultDate));
    setDatePickerTarget(null);
    setSort('upcoming');
    setCategoryQuery('');
  }

  return (
    <Screen contentStyle={styles.screen}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} label="Geri" onPress={navigation.goBack} />
        <AppText variant="headingMd">Filtreler</AppText>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <View style={styles.group}>
          <AppText variant="label">Şehir</AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Etkinlik şehri seç"
            accessibilityValue={{ text: city ?? 'Tüm şehirler' }}
            onPress={() => navigation.navigate('CityPicker')}
            style={({ pressed }) => [
              styles.selector,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.selectorIcon}>
              <MapPin size={19} color={colors.brand} />
            </View>
            <View style={styles.selectorText}>
              <AppText variant="label">{city ?? 'Tüm şehirler'}</AppText>
              <AppText variant="caption" tone="secondary">
                {city
                  ? 'Kayıt sırasında seçtiğin şehir varsayılandır.'
                  : 'Türkiye genelindeki etkinlikleri gösterir.'}
              </AppText>
            </View>
            <ChevronRight size={20} color={colors.textTertiary} />
          </Pressable>
        </View>

        <View style={styles.group}>
          <AppText variant="label">Tarih</AppText>
          <View style={styles.chips}>
            {dateOptions.map(option => (
              <Chip
                key={option.value}
                label={option.label}
                selected={date === option.value}
                onPress={() => selectDatePreset(option.value)}
              />
            ))}
          </View>
          <View
            style={[
              styles.dateRangeCard,
              rangeSelected && styles.dateRangeCardSelected,
            ]}
          >
            <View style={styles.dateRangeTitle}>
              <View style={styles.selectorIcon}>
                <CalendarDays size={19} color={colors.brand} />
              </View>
              <View style={styles.selectorText}>
                <AppText variant="label">Tarih aralığı</AppText>
                <AppText variant="caption" tone="secondary">
                  Başlangıç ve bitiş günlerini seç
                </AppText>
              </View>
            </View>

            <View style={styles.dateRangeFields}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Başlangıç tarihini seç"
                accessibilityValue={{
                  text: dateRange
                    ? format(dateRange.start, 'd MMMM yyyy', { locale: tr })
                    : 'Seçilmedi',
                }}
                onPress={() => setDatePickerTarget('start')}
                style={({ pressed }) => [
                  styles.dateRangeField,
                  pressed && styles.pressed,
                ]}
              >
                <AppText variant="caption" tone="secondary">
                  Başlangıç
                </AppText>
                <AppText variant="body" tone={dateRange ? 'brand' : 'primary'}>
                  {dateRange
                    ? format(dateRange.start, 'd MMM yyyy', { locale: tr })
                    : 'Tarih seç'}
                </AppText>
              </Pressable>
              <ChevronRight size={18} color={colors.textTertiary} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Bitiş tarihini seç"
                accessibilityValue={{
                  text: dateRange
                    ? format(dateRange.end, 'd MMMM yyyy', { locale: tr })
                    : 'Seçilmedi',
                }}
                onPress={() => setDatePickerTarget('end')}
                style={({ pressed }) => [
                  styles.dateRangeField,
                  pressed && styles.pressed,
                ]}
              >
                <AppText variant="caption" tone="secondary">
                  Bitiş
                </AppText>
                <AppText variant="body" tone={dateRange ? 'brand' : 'primary'}>
                  {dateRange
                    ? format(dateRange.end, 'd MMM yyyy', { locale: tr })
                    : 'Tarih seç'}
                </AppText>
              </Pressable>
            </View>
          </View>
          {datePickerTarget ? (
            <DateTimePicker
              value={
                (datePickerTarget === 'start'
                  ? dateRange?.start
                  : dateRange?.end) ?? new Date()
              }
              mode="date"
              display="default"
              minimumDate={
                datePickerTarget === 'end'
                  ? dateRange?.start ?? undefined
                  : undefined
              }
              onChange={(event, nextDate) => {
                const target = datePickerTarget;
                setDatePickerTarget(null);
                if (event.type === 'dismissed' || !nextDate) return;
                selectRangeDate(target, nextDate);
              }}
            />
          ) : null}
        </View>

        <View style={styles.group}>
          <AppText variant="label">Sıralama</AppText>
          <View style={styles.chips}>
            {sortOptions.map(option => (
              <Chip
                key={option.value}
                label={option.label}
                selected={sort === option.value}
                onPress={() => setSort(option.value)}
              />
            ))}
          </View>
        </View>

        <View style={styles.group}>
          <View style={styles.groupTitleRow}>
            <AppText variant="label">Kategoriler</AppText>
            <AppText variant="caption" tone="brand">
              {categories.length ? `${categories.length} seçili` : 'Tümü'}
            </AppText>
          </View>
          <View style={styles.searchBox}>
            <Search size={19} color={colors.textTertiary} />
            <TextInput
              accessibilityLabel="Kategori ara"
              value={categoryQuery}
              onChangeText={setCategoryQuery}
              placeholder="Kategori ara"
              placeholderTextColor={colors.textTertiary}
              maxLength={50}
              autoCorrect={false}
              style={styles.input}
            />
            {categoryQuery ? (
              <IconButton
                icon={X}
                label="Kategori aramasını temizle"
                onPress={() => setCategoryQuery('')}
                style={styles.clearButton}
              />
            ) : null}
          </View>

          <View style={styles.categoryList}>
            {!deferredCategoryQuery ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel="Tüm kategoriler"
                accessibilityState={{ checked: categories.length === 0 }}
                onPress={() => setCategories([])}
                style={({ pressed }) => [
                  styles.categoryRow,
                  styles.rowBorder,
                  categories.length === 0 && styles.categoryRowSelected,
                  pressed && styles.pressed,
                ]}
              >
                <AppText
                  variant={categories.length === 0 ? 'label' : 'body'}
                  style={styles.categoryText}
                >
                  Tümü
                </AppText>
                <View
                  style={[
                    styles.checkbox,
                    categories.length === 0 && styles.checkboxSelected,
                  ]}
                >
                  {categories.length === 0 ? (
                    <Check size={15} color={colors.textInverse} />
                  ) : null}
                </View>
              </Pressable>
            ) : null}
            {categoryOptions.length ? (
              categoryOptions.map((category, index) => {
                const categoryKey = normalizeTurkishSearch(category);
                const selected = categories.some(
                  item => normalizeTurkishSearch(item) === categoryKey,
                );
                return (
                  <Pressable
                    key={categoryKey}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${category} kategorisi`}
                    accessibilityState={{ checked: selected }}
                    onPress={() => toggleCategory(category)}
                    style={({ pressed }) => [
                      styles.categoryRow,
                      index < categoryOptions.length - 1 && styles.rowBorder,
                      selected && styles.categoryRowSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <AppText
                      variant={selected ? 'label' : 'body'}
                      style={styles.categoryText}
                    >
                      {category}
                    </AppText>
                    <View
                      style={[
                        styles.checkbox,
                        selected && styles.checkboxSelected,
                      ]}
                    >
                      {selected ? (
                        <Check size={15} color={colors.textInverse} />
                      ) : null}
                    </View>
                  </Pressable>
                );
              })
            ) : (
              <View style={styles.emptyCategory}>
                <AppText variant="body" tone="secondary" align="center">
                  Bu aramayla eşleşen kategori bulunamadı.
                </AppText>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <AppButton label="Temizle" variant="ghost" onPress={clearFilters} />
        <AppButton
          label="Sonuçları göster"
          onPress={() => {
            setFilters({ categories, date, sort });
            navigation.goBack();
          }}
        />
      </View>
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
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerSpacer: { width: layout.touchTarget },
  content: { padding: spacing.md, gap: spacing.xl, paddingBottom: spacing.xl },
  group: { gap: spacing.sm },
  groupTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selector: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dateRangeCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.sm,
  },
  dateRangeCardSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  dateRangeTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dateRangeFields: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dateRangeField: {
    flex: 1,
    minHeight: layout.touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    gap: 2,
  },
  selectorIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  selectorText: { flex: 1, gap: 2 },
  searchBox: {
    minHeight: layout.touchTarget,
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
    ...typography.body,
    flex: 1,
    minHeight: layout.touchTarget,
    color: colors.textPrimary,
  },
  clearButton: { width: 44, height: 44, borderWidth: 0 },
  categoryList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  categoryRow: {
    minHeight: 50,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  categoryRowSelected: { backgroundColor: colors.brandSoft },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  categoryText: { flex: 1 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  checkboxSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  emptyCategory: { padding: spacing.lg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  actions: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.7 },
});
