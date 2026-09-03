import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = relativePath => readFileSync(resolve(root, relativePath), 'utf8');

const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

function collectSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return collectSourceFiles(path);
    if (!/\.tsx?$/u.test(entry.name)) return [];
    if (/\.test\.tsx?$/u.test(entry.name)) return [];
    return [path.replace(/\\/gu, '/')];
  });
}

const authService = read('src/features/auth/authService.ts');
const pendingVerification = read(
  'src/features/auth/pendingVerificationService.ts',
);
const pushDispatcher = read('../supabase/functions/push-dispatch/index.ts');
const pushReceipts = read('../supabase/functions/push-receipts/index.ts');
const pushDispatchTests = read(
  '../supabase/functions/push-dispatch/index.test.ts',
);
const pushReceiptTests = read(
  '../supabase/functions/push-receipts/index.test.ts',
);
const databaseSecurityTests = read('../supabase/tests/rls_and_security.sql');
const aclContractTests = read('../supabase/tests/rpc_role_acl_contract.sql');
const eslintConfig = read('.eslintrc.js');
const telemetry = read('src/shared/lib/telemetry.ts');
// A release build still ships console output to logcat/os_log, so only the
// redacting telemetry helper may write there. Anything else would leak the raw
// Expo push token, a signed Storage URL or a PostgREST row fragment.
const consoleCallers = collectSourceFiles(resolve(root, 'src')).filter(
  file =>
    !file.endsWith('src/shared/lib/telemetry.ts') &&
    /(^|[^\w.])console\s*\./u.test(readFileSync(file, 'utf8')),
);
const mobileCi = read('../.github/workflows/mobile-ci.yml');
const androidBuild = read('android/app/build.gradle');
const androidProguard = read('android/app/proguard-rules.pro');
const workflowsRoot = resolve(root, '../.github/workflows');
const workflowActions = readdirSync(workflowsRoot)
  .filter(name => /\.ya?ml$/u.test(name))
  .flatMap(name => {
    const source = readFileSync(resolve(workflowsRoot, name), 'utf8');
    return [...source.matchAll(/^\s*-\s*uses:\s*([^#\s]+)/gmu)].map(match => ({
      action: match[1] ?? '',
      workflow: name,
    }));
  });
const databaseTestPlan = Number(
  databaseSecurityTests.match(/select\s+plan\((\d+)\);/iu)?.[1] ?? 0,
);

assert(
  !authService.includes("flowType: 'implicit'"),
  'Auth recovery implicit flow kullanmamalı.',
);
assert(
  !authService.includes('supabase.auth.setSession'),
  'Auth callback ham token ile setSession çağırmamalı.',
);
assert(
  authService.includes('exchangeCodeForSession'),
  'Auth callback PKCE kod değişimi kullanmalı.',
);
assert(
  !/password\s*:/u.test(pendingVerification),
  'Bekleyen doğrulama kaydı parola alanı içermemeli.',
);
assert(
  pushDispatcher.includes('PUSH_WORKER_SECRET') &&
    pushDispatcher.includes('authorizeWorkerRequest') &&
    pushDispatcher.includes('consume_push_worker_nonce'),
  'Push dispatcher worker secret doğrulaması yapmalı.',
);
assert(
  pushReceipts.includes('PUSH_WORKER_SECRET') &&
    pushReceipts.includes('authorizeWorkerRequest') &&
    pushReceipts.includes('consume_push_worker_nonce'),
  'Push receipt worker secret doğrulaması yapmalı.',
);
assert(
  pushDispatchTests.includes('partial Expo failure') &&
    pushReceiptTests.includes('invalid-token cleanup'),
  'Push dispatch/receipt kritik regresyon testleri korunmalı.',
);
assert(
  databaseTestPlan >= 44 &&
    databaseSecurityTests.includes(
      "has_table_privilege('anon', 'auth.users', 'SELECT')",
    ),
  'pgTAP planı ve auth.users enumeration koruması korunmalı.',
);
assert(
  mobileCi.includes(
    'deno test --frozen --node-modules-dir=auto supabase/functions/**/*.test.ts',
  ) && mobileCi.includes('npm run coverage:ratchet'),
  'CI Edge Function testlerini ve coverage ratchet kapısını çalıştırmalı.',
);
assert(
  !androidBuild.includes(
    'release {\n            signingConfig signingConfigs.debug',
  ),
  'Android release debug anahtarıyla imzalanmamalı.',
);
assert(
  androidBuild.includes('minifyEnabled enableProguardInReleaseBuilds') &&
    androidBuild.includes('shrinkResources enableProguardInReleaseBuilds'),
  'Android release küçültme kapıları açık olmalı.',
);
assert(
  androidProguard.includes('-keep class com.etkinlink.app.BuildConfig { *; }'),
  'R8, react-native-config BuildConfig alanlarını reflection için korumalı.',
);
assert(
  eslintConfig.includes("'no-console': 'error'") &&
    /files:\s*\['src\/shared\/lib\/telemetry\.ts'\]/u.test(eslintConfig),
  'Konsol yazımı yalnız redaksiyonlu telemetry yardımcısına açık olmalı.',
);
assert(
  telemetry.includes('export function warnRedacted') &&
    /console\.warn\(sanitizeText\(message\), toAppError\(error\)\.code\)/u.test(
      telemetry,
    ),
  'warnRedacted yalnız sabit mesaj ve kararlı AppError kodunu loglamalı.',
);
for (const source of consoleCallers) {
  assert(
    false,
    `${source}: ham hata konsola yazılamaz; warnRedacted kullanılmalı.`,
  );
}
assert(
  aclContractTests.includes(
    'Service role hiçbir owner-scoped client RPCsini çalıştıramaz',
  ) &&
    aclContractTests.includes(
      'Anon yalnız kayıt öncesi ve public katalog uçlarını çalıştırabilir',
    ),
  'Owner-scoped RPC rol ACL sözleşmesi pgTAP ile korunmalı.',
);
for (const { action, workflow } of workflowActions) {
  assert(
    action.startsWith('./') || /@[0-9a-f]{40}$/u.test(action),
    `${workflow}: ${action} değişmez commit SHA'sına sabitlenmeli.`,
  );
}

if (failures.length > 0) {
  console.error('Güvenlik guard hataları:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(
  'Auth, push worker, release signing ve CI action pin güvenlik guardları geçti.',
);
