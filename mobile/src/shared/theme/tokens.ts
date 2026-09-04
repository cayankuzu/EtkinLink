import { Platform } from 'react-native';

export const colors = {
  canvas: '#F7F8FC',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F3F9',
  surfaceSoft: '#F8F7FF',
  brand: '#5B4BFF',
  brandPressed: '#4C3CE8',
  brandSoft: '#EEEAFE',
  brandSubtle: '#F5F2FF',
  infoSoft: '#EEF4FF',
  accent: '#FF6B5E',
  accentSoft: '#FFF0EE',
  // Coral is a fill, not a text colour: #FF6B5E only reaches 2.52:1 on
  // accentSoft. Every other soft surface here already pairs with a dark
  // partner (success/warning/danger); this restores that pairing, held
  // away from danger in hue so the two stay tellable apart.
  accentStrong: '#C2410C',
  textPrimary: '#101828',
  textSecondary: '#475467',
  textTertiary: '#667085',
  textInverse: '#FFFFFF',
  iconPrimary: '#344054',
  border: '#E4E7EC',
  borderStrong: '#D0D5DD',
  success: '#087A55',
  successSoft: '#EAFBF4',
  warning: '#B54708',
  warningSoft: '#FFF4E5',
  danger: '#D92D20',
  dangerPressed: '#C7353B',
  dangerSoft: '#FFF0F0',
  overlay: 'rgba(16, 24, 40, 0.56)',
  overlaySubtle: 'rgba(16, 24, 40, 0.12)',
  dangerBorder: '#FFD5D2',
  // Full-screen photo viewers deliberately drop to a near-black canvas so the
  // image, not the chrome, carries the surface.
  mediaCanvas: '#050505',
  // Controls that float directly on top of a photo.
  glassSurface: 'rgba(255, 255, 255, 0.92)',
  glassBorderSoft: 'rgba(255, 255, 255, 0.72)',
  glassBorderStrong: 'rgba(255, 255, 255, 0.86)',
  // Swipe affordances tint the card with the brand/accent hue.
  likeOverlay: 'rgba(91, 75, 255, 0.26)',
  passOverlay: 'rgba(255, 107, 94, 0.18)',
  transparent: 'transparent',
} as const;

export const spacing = {
  xxs: 4,
  xs: 6,
  sm: 10,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 36,
} as const;

export const radius = {
  sm: 8,
  md: 10,
  lg: 14,
  xl: 16,
  xxl: 20,
  full: 999,
} as const;

// Role names, not size names. The previous scale was size-suffixed and every
// suffix had drifted from its value after a retune, so a developer reaching
// for "body16" silently got 14px. Roles describe intent and cannot go stale.
// The smallest tier is 12px: the old 10px tier carried event dates, chat
// timestamps and compatibility labels, which is real content, not decoration.
export const typography = {
  display: {
    fontFamily: 'Manrope',
    fontSize: 26,
    lineHeight: 33,
    fontWeight: '700' as const,
  },
  headingXl: {
    fontFamily: 'Manrope',
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700' as const,
  },
  headingLg: {
    fontFamily: 'Manrope',
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.2,
    fontWeight: '700' as const,
  },
  headingMd: {
    fontFamily: 'Manrope',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700' as const,
  },
  headingSm: {
    fontFamily: 'Manrope',
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '600' as const,
  },
  bodyLg: {
    fontFamily: 'Inter',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400' as const,
  },
  body: {
    fontFamily: 'Inter',
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '400' as const,
  },
  label: {
    fontFamily: 'Inter',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600' as const,
  },
  labelSm: {
    fontFamily: 'Inter',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600' as const,
  },
  overline: {
    fontFamily: 'Inter',
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0.1,
    fontWeight: '500' as const,
  },
  caption: {
    fontFamily: 'Inter',
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0.2,
    fontWeight: '500' as const,
  },
} as const;

export const shadows = {
  card: Platform.select({
    ios: {
      shadowColor: '#101828',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
    },
    android: { elevation: 2 },
    default: {},
  }),
  floating: Platform.select({
    ios: {
      shadowColor: '#101828',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.16,
      shadowRadius: 18,
    },
    android: { elevation: 8 },
    default: {},
  }),
  match: Platform.select({
    ios: {
      shadowColor: '#5B4BFF',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.26,
      shadowRadius: 24,
    },
    android: { elevation: 10 },
    default: {},
  }),
} as const;

export const layout = {
  screenPadding: 12,
  touchTarget: 48,
  compactTouchTarget: 44,
  controlHeight: 44,
  inputHeight: 48,
  headerHeight: 56,
  tabBarHeight: 56,
  maxContentWidth: 640,
  maxModalWidth: 520,
} as const;
