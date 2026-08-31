import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const snapshotPath = path.join(root, 'quality/feature-surface.snapshot.json');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function sorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function filesRecursively(directory, predicate) {
  const absolute = path.join(root, directory);
  const result = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.posix.join(directory.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) result.push(...filesRecursively(relative, predicate));
    else if (predicate(relative)) result.push(relative);
  }
  return result;
}

function stringLiterals(value) {
  return [...value.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]);
}

function extractRoutes() {
  const source = read('mobile/src/app/navigation/types.ts');
  const routes = {};
  const typePattern = /export type (\w+StackParamList)\s*=\s*\{([\s\S]*?)\n\};/gu;
  for (const match of source.matchAll(typePattern)) {
    routes[match[1]] = sorted(
      [...match[2].matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_]*):/gmu)].map(
        property => property[1],
      ),
    );
  }
  const tabsBlock = source.match(/export type MainTabParamList\s*=\s*\{([\s\S]*?)\n\};/u)?.[1] ?? '';
  const tabs = sorted(
    [...tabsBlock.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9_]*):/gmu)].map(
      property => property[1],
    ),
  );
  return { routes, tabs };
}

function extractModals() {
  const result = {};
  for (const file of filesRecursively('mobile/src', relative => relative.endsWith('.tsx'))) {
    const count = [...read(file).matchAll(/<Modal\b/gu)].length;
    if (count > 0) result[file] = count;
  }
  return result;
}

function extractNativeSurface() {
  const app = JSON.parse(read('mobile/app.json')).expo;
  const manifest = read('mobile/android/app/src/main/AndroidManifest.xml');
  const info = read('mobile/ios/EtkinLink/Info.plist');
  const entitlements = read('mobile/ios/EtkinLink/EtkinLink.entitlements');
  const plugins = (app.plugins ?? []).map(plugin =>
    Array.isArray(plugin) ? plugin[0] : plugin,
  );
  return {
    androidPermissions: sorted(
      [...manifest.matchAll(/<uses-permission\s+android:name="([^"]+)"/gu)].map(
        match => match[1],
      ),
    ),
    iosUsageDescriptionKeys: sorted(
      [...info.matchAll(/<key>(NS[A-Za-z0-9]+UsageDescription)<\/key>/gu)].map(
        match => match[1],
      ),
    ),
    iosEntitlements: sorted(
      [...entitlements.matchAll(/<key>([^<]+)<\/key>/gu)].map(match => match[1]),
    ),
    permissionPlugins: sorted(
      plugins.filter(plugin =>
        ['expo-media-library', 'expo-notifications'].includes(plugin),
      ),
    ),
    schemes: sorted([
      ...(typeof app.scheme === 'string' ? [app.scheme] : app.scheme ?? []),
      ...[...manifest.matchAll(/<data\s+[^>]*android:scheme="([^"]+)"/gu)].map(
        match => match[1],
      ),
    ]),
  };
}

function extractSettings() {
  const source = read('mobile/src/features/profile/SettingsScreen.tsx');
  const groups = sorted(
    [...source.matchAll(/<SettingsGroup\s+title="([^"]+)"/gu)].map(
      match => match[1],
    ),
  );
  const rowTitles = [];
  for (const match of source.matchAll(/<Setting(?:Toggle)?Row\b([\s\S]*?)\/>/gu)) {
    const attributes = match[1];
    const literal = attributes.match(/\btitle="([^"]+)"/u)?.[1];
    if (literal) rowTitles.push(literal);
    const expression = attributes.match(/\btitle=\{([\s\S]*?)\}/u)?.[1];
    if (expression) rowTitles.push(...stringLiterals(expression));
  }
  return { groups, rowTitles: sorted(rowTitles) };
}

function extractNotificationTypes() {
  const navigation = read('mobile/src/app/navigation/notificationNavigation.ts');
  const values = [
    ...navigation.matchAll(/\bkind\s*===\s*'([^']+)'/gu),
  ].map(match => match[1]);
  for (const file of filesRecursively('supabase/migrations', relative => relative.endsWith('.sql'))) {
    const source = read(file);
    const constraint = source.match(
      /constraint\s+notification_events_kind\s+check\s*\(\s*kind\s+in\s*\(([^)]+)\)/iu,
    );
    if (constraint) values.push(...stringLiterals(constraint[1]));
  }
  return sorted(values);
}

function extractTables() {
  const result = [];
  for (const file of filesRecursively('supabase/migrations', relative => relative.endsWith('.sql'))) {
    const source = read(file);
    for (const match of source.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?((?:public|private)\.[A-Za-z0-9_]+)/giu,
    )) {
      result.push(match[1].toLowerCase());
    }
  }
  return sorted(result.filter(table => table.startsWith('public.')));
}

function extractFunctions() {
  return sorted(
    fs
      .readdirSync(path.join(root, 'supabase/functions'), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('_'))
      .map(entry => entry.name),
  );
}

export function collectSurface() {
  const { routes, tabs } = extractRoutes();
  return {
    routes,
    tabs,
    screenEntrypoints: sorted(
      filesRecursively('mobile/src/features', relative => relative.endsWith('Screen.tsx')),
    ),
    modalEntrypoints: extractModals(),
    nativeSurface: extractNativeSurface(),
    notificationTypes: extractNotificationTypes(),
    supabaseFunctions: extractFunctions(),
    publicTables: extractTables(),
    visibleSettings: extractSettings(),
  };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map(key => [key, canonical(value[key])]),
    );
  }
  return value;
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function allowedInternalTable(table) {
  const name = table.replace(/^public\./u, '');
  return /^(?:security_|ops_|audit_|telemetry_|outbox_|.*_(?:audit|telemetry|outbox|deliveries?))/.test(
    name,
  );
}

function allowedInternalFunction(name) {
  return /(?:-internal|-ops|-worker|-webhook)$/u.test(name);
}

export function compareSurface(snapshot, actual) {
  const violations = [];
  for (const field of ['tabs', 'screenEntrypoints', 'modalEntrypoints', 'nativeSurface', 'notificationTypes', 'visibleSettings']) {
    if (!same(snapshot[field], actual[field])) {
      violations.push(
        `${field} değişti; beklenen=${JSON.stringify(snapshot[field])} gerçek=${JSON.stringify(actual[field])}`,
      );
    }
  }
  if (!same(snapshot.routes, actual.routes)) violations.push('navigation route sözleşmesi değişti');

  const missingTables = snapshot.publicTables.filter(table => !actual.publicTables.includes(table));
  const newTables = actual.publicTables.filter(
    table => !snapshot.publicTables.includes(table) && !allowedInternalTable(table),
  );
  if (missingTables.length) violations.push(`ürün tabloları kayıp: ${missingTables.join(', ')}`);
  if (newTables.length) violations.push(`yeni ürün tablosu: ${newTables.join(', ')}`);

  const missingFunctions = snapshot.supabaseFunctions.filter(
    name => !actual.supabaseFunctions.includes(name),
  );
  const newFunctions = actual.supabaseFunctions.filter(
    name => !snapshot.supabaseFunctions.includes(name) && !allowedInternalFunction(name),
  );
  if (missingFunctions.length) violations.push(`Edge Function kayıp: ${missingFunctions.join(', ')}`);
  if (newFunctions.length) violations.push(`yeni ürün Edge Function'ı: ${newFunctions.join(', ')}`);
  return violations;
}

function selfTest(snapshot) {
  const actual = structuredClone(snapshot);
  actual.routes.AuthStackParamList.push('ForbiddenNewRoute');
  actual.nativeSurface.androidPermissions.push('android.permission.CAMERA');
  actual.visibleSettings.rowTitles.push('Yeni ürün CTA');
  actual.publicTables.push('public.new_product_domain');
  const violations = compareSurface(snapshot, actual);
  assert(violations.some(value => value.includes('navigation route')));
  assert(violations.some(value => value.includes('nativeSurface')));
  assert(violations.some(value => value.includes('visibleSettings')));
  assert(violations.some(value => value.includes('yeni ürün tablosu')));
  console.log('Feature-surface guard self-test: beklenen dört ihlal yakalandı.');
}

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
if (process.argv.includes('--self-test')) {
  selfTest(snapshot);
} else {
  const actual = collectSurface();
  const violations = compareSurface(snapshot, actual);
  if (violations.length > 0) {
    console.error('Feature-freeze ihlali:');
    for (const violation of violations) console.error(`- ${violation}`);
    process.exit(1);
  }
  const routeCount = Object.values(actual.routes).reduce(
    (total, routes) => total + routes.length,
    0,
  );
  console.log(
    `Feature-freeze guard geçti: ${actual.tabs.length} tab, ${routeCount} stack route, ${actual.screenEntrypoints.length} ekran, ${actual.publicTables.length} public tablo.`,
  );
}
