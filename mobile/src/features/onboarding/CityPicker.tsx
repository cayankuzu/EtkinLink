import { AppText, IconButton, TextField } from '@shared/components';
import {
  normalizeTurkishSearch,
  TURKISH_CITIES,
} from '@shared/constants/cities';
import { contentLimits } from '@shared/constants/limits';
import { colors, layout, radius, spacing } from '@shared/theme';
import { ChevronDown, MapPin, Search, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';

type CityPickerProps = {
  value: string;
  onChange: (city: string) => void;
  error?: string;
};

export function CityPicker({ value, onChange, error }: CityPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const items = useMemo(() => {
    const normalized = normalizeTurkishSearch(query.trim());
    if (!normalized) return TURKISH_CITIES;
    return TURKISH_CITIES.filter(city =>
      normalizeTurkishSearch(city).includes(normalized),
    );
  }, [query]);

  return (
    <View style={styles.wrapper}>
      <AppText variant="labelSm">Şehir</AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Şehir seç"
        accessibilityValue={{ text: value || 'Seçilmedi' }}
        onPress={() => setOpen(true)}
        style={[styles.trigger, error ? styles.triggerError : null]}
      >
        <View style={styles.triggerValue}>
          <MapPin
            size={20}
            color={value ? colors.brand : colors.textTertiary}
          />
          <AppText tone={value ? 'primary' : 'tertiary'}>
            {value || 'Şehir seç'}
          </AppText>
        </View>
        <ChevronDown size={20} color={colors.textSecondary} />
      </Pressable>
      {error ? (
        <AppText variant="caption" tone="danger">
          {error}
        </AppText>
      ) : null}
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modal}>
          <View style={styles.header}>
            <View>
              <AppText variant="headingMd">Şehir seç</AppText>
              <AppText variant="caption" tone="secondary">
                Türkiye'nin 81 ili
              </AppText>
            </View>
            <IconButton icon={X} label="Kapat" onPress={() => setOpen(false)} />
          </View>
          <TextField
            label="Şehir ara"
            value={query}
            onChangeText={setQuery}
            maxLength={contentLimits.citySearch}
            placeholder="Örn. İstanbul"
            leadingIcon={Search}
            autoCapitalize="words"
          />
          <FlatList
            data={items}
            keyExtractor={item => item}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <AppText tone="secondary" align="center">
                Aramana uygun şehir bulunamadı.
              </AppText>
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: item === value }}
                onPress={() => {
                  onChange(item);
                  setOpen(false);
                  setQuery('');
                }}
                style={({ pressed }) => [
                  styles.city,
                  item === value && styles.citySelected,
                  pressed && styles.cityPressed,
                ]}
              >
                <AppText
                  variant={item === value ? 'label' : 'body'}
                  tone={item === value ? 'brand' : 'primary'}
                >
                  {item}
                </AppText>
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  trigger: {
    minHeight: layout.touchTarget,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  triggerError: { borderColor: colors.danger },
  triggerValue: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  modal: {
    flex: 1,
    backgroundColor: colors.canvas,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  city: {
    minHeight: layout.touchTarget,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
  },
  citySelected: { backgroundColor: colors.brandSoft },
  cityPressed: { opacity: 0.7 },
});
