import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

// Screen state coverage, measured rather than asserted.
//
// The product freeze forbids new state screens, so the question is not "should
// we build an empty state" but "does each screen that fetches something already
// say what happened". A screen that renders nothing while loading, or renders an
// empty list identically whether the query is empty or failed, leaves the user
// asking "did it work?" — which is the failure the UX contract is written
// against.
//
// This reads the screens and reports which states each one expresses. It is a
// coverage report, not a pass/fail gate for every cell: a screen with no remote
// data legitimately has no loading state, so only screens that actually fetch
// are held to the fetch-state contract.

const CONTRACT = {
  // A query's three outcomes have to be distinguishable on screen.
  // `isFetching` counts: a background refetch that shows nothing is the same
  // "did it work?" failure as a first load that shows nothing.
  loading: /isLoading|isPending|isFetching|<Skeleton|ActivityIndicator/u,
  error: /isError|<ErrorState|ErrorState\b|error \?/u,
  empty: /<StateView|length === 0|\.length\s*\?|ListEmptyComponent/u,
  refresh: /RefreshableContent|RefreshControl|refetch|isRefetching/u,
  // Not every screen can be offline-aware, but the ones that fetch should not
  // present a network failure as an empty result.
  offline: /offline|isConnected|NetInfo|çevrimdışı|bağlantı/iu,
  keyboard: /KeyboardAvoiding|keyboardShouldPersistTaps|KeyboardAware/u,
  // `<Screen>` owns safe-area insets for the whole app; a screen that renders
  // inside it is covered, and looking for SafeAreaView in the screen file would
  // report every one of them as a gap.
  safeArea: /<Screen\b|SafeAreaView|useSafeArea|edges=/u,
  busy: /busy|disabled=\{|loading=\{/u,
};

const FETCHES = /useQuery|useInfiniteQuery|useMutation|supabase\s*\./u;
// A query owes loading and error; a screen whose only remote work is a mutation
// owes a busy state instead. Holding a password form to a "loading" contract
// invents a gap rather than finding one.
const QUERIES = /useQuery|useInfiniteQuery/u;
// Only a screen that renders a collection can be empty. A form over the user's
// own record always has a record, so demanding an empty state there would
// manufacture a gap rather than find one.
const RENDERS_LIST = /FlashList|FlatList|SectionList|ListEmptyComponent/u;
// A query backed by a complete local default never blocks the user, so it owes
// no loading or error surface. The event filter sheet is the case: it ships the
// default category list and treats the fetch as an upgrade.
const HAS_LOCAL_FALLBACK = /DEFAULT_[A-Z_]+|\.data\?\.length\s*$|\?\?\s*\[/mu;
const IS_SCREEN = /Screen\.tsx$/u;

export function collectScreens(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectScreens(path);
    if (!IS_SCREEN.test(entry.name)) return [];
    if (/\.test\.tsx$/u.test(entry.name)) return [];
    return [path];
  });
}

export function inspectScreen(source) {
  const states = Object.fromEntries(
    Object.entries(CONTRACT).map(([state, pattern]) => [state, pattern.test(source)]),
  );
  return {
    fetches: FETCHES.test(source),
    queries: QUERIES.test(source),
    rendersList: RENDERS_LIST.test(source),
    hasLocalFallback: HAS_LOCAL_FALLBACK.test(source),
    states,
  };
}

function main() {
  const root = resolve(import.meta.dirname, '..');
  const screens = collectScreens(join(root, 'src/features'))
    .map(file => {
      const source = readFileSync(file, 'utf8');
      const relative = file.slice(root.length + 1).replaceAll('\\', '/');
      return {
        screen: basename(file, '.tsx'),
        feature: relative.split('/')[2],
        path: relative,
        ...inspectScreen(source),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const columns = Object.keys(CONTRACT);
  const fetching = screens.filter(screen => screen.fetches);
  // Only the states a fetching screen owes the user are counted as gaps.
  const owed = screen => {
    if (!screen.queries) return ['busy'];
    if (screen.hasLocalFallback) return screen.rendersList ? ['empty'] : [];
    return ['loading', 'error', ...(screen.rendersList ? ['empty'] : [])];
  };
  const gaps = fetching.flatMap(screen =>
    owed(screen)
      .filter(state => !screen.states[state])
      .map(state => ({ screen: screen.screen, path: screen.path, state })),
  );

  const rows = screens.map(screen =>
    `| ${screen.screen} | ${screen.feature} | ${screen.fetches ? 'evet' : 'hayır'} | ` +
    `${screen.rendersList ? 'evet' : 'hayır'} | ` +
    `${columns.map(state => (screen.states[state] ? '✓' : '·')).join(' | ')} |`,
  );

  const document = [
    '# EtkinLink — Ekran Durum Matrisi',
    '',
    '> Bu dosya `npm run screen-state:matrix` ile üretilir; elle düzenlenmez.',
    `> Kaynak: ${screens.length} ekran girişi, \`mobile/src/features/**/*Screen.tsx\`.`,
    '',
    'Ürün dondurması gereği yeni durum ekranı eklenmez. Buradaki soru "boş durum',
    'yapalım mı" değil, "veri çeken her ekran ne olduğunu söylüyor mu" sorusudur.',
    'Yükleniyor, hata ve boş durumu birbirinden ayırt edilemeyen bir ekran',
    'kullanıcıyı "oldu mu?" sorusuyla bırakır.',
    '',
    '`·` işareti eksiklik değil, **o ekranda o durumun ifade edilmediği** anlamına',
    'gelir. Veri çekmeyen bir ekranın yükleme durumu olmaması doğrudur.',
    '',
    `| Ekran | Alan | Veri çeker | Liste | ${columns.join(' | ')} |`,
    `|---|---|---|---|${columns.map(() => '---').join('|')}|`,
    ...rows,
    '',
    '## Özet',
    '',
    `- Ekran girişi: **${screens.length}**`,
    `- Veri çeken ekran: **${fetching.length}**`,
    ...columns.map(state => {
      const covered = fetching.filter(screen => screen.states[state]).length;
      return `- Veri çeken ekranlarda \`${state}\`: **${covered}/${fetching.length}**`;
    }),
    '',
    '## Zorunlu sözleşme boşlukları',
    '',
    'Sorgu çalıştıran ekran `loading` ve `error` durumlarını ayırt edilebilir',
    'biçimde ifade etmelidir. Yalnız mutation çalıştıran ekran bunun yerine',
    '`busy` borçludur. `empty` yalnız koleksiyon çizen ekranlar için zorunludur;',
    'kullanıcının kendi kaydı üzerindeki form her zaman doludur. Tam yerel',
    'yedeği olan sorgu kullanıcıyı hiç bekletmediği için yükleme/hata yüzeyi',
    'borçlu değildir.',
    '',
    gaps.length === 0
      ? 'Boşluk yok.'
      : ['| Ekran | Eksik durum | Dosya |', '|---|---|---|',
         ...gaps.map(gap => `| ${gap.screen} | \`${gap.state}\` | ${gap.path} |`)].join('\n'),
    '',
  ].join('\n');

  const output = join(root, '..', 'docs', 'audit', 'ui-screen-state-matrix.md');
  writeFileSync(output, document, 'utf8');

  if (process.argv.includes('--check') && gaps.length > 0) {
    console.error('Ekran durum sözleşmesi boşlukları:');
    gaps.forEach(gap =>
      console.error(`- ${gap.path}: ${gap.state} durumu ifade edilmiyor.`),
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify({
      event: 'screen_state_matrix_built',
      screens: screens.length,
      fetching: fetching.length,
      gaps: gaps.length,
    }),
  );
}

if (process.argv[1]?.endsWith('build-screen-state-matrix.mjs')) main();
