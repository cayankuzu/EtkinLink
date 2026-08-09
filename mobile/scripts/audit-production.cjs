const { spawnSync } = require('node:child_process');
const path = require('node:path');

const allowedAdvisories = new Set([
  'GHSA-w3rx-r6r6-pgpr',
  'GHSA-5p2g-fcmc-qvqq',
]);

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error(
    'Bu kontrol `npm run audit:production` üzerinden çalıştırılmalıdır.',
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [npmCli, 'audit', '--omit=dev', '--json'],
  {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  },
);

if (result.error) {
  console.error(`npm audit çalıştırılamadı: ${result.error.message}`);
  process.exit(1);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch (error) {
  console.error(result.stderr || result.stdout);
  console.error(`npm audit çıktısı okunamadı: ${error.message}`);
  process.exit(1);
}

const vulnerabilities = report.vulnerabilities ?? {};
const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

function advisoryId(entry) {
  if (typeof entry !== 'object' || entry === null) {
    return null;
  }

  return entry.url?.match(/GHSA-[a-z0-9-]+/i)?.[0] ?? null;
}

function collectAdvisories(packageName, visiting = new Set()) {
  if (visiting.has(packageName)) {
    return { valid: true, ids: new Set() };
  }

  const vulnerability = vulnerabilities[packageName];
  if (
    !vulnerability ||
    !Array.isArray(vulnerability.via) ||
    vulnerability.via.length === 0
  ) {
    return { valid: false, ids: new Set() };
  }

  const nextVisiting = new Set(visiting).add(packageName);
  const ids = new Set();

  for (const entry of vulnerability.via) {
    if (typeof entry === 'string') {
      const child = collectAdvisories(entry, nextVisiting);
      if (!child.valid) {
        return { valid: false, ids: new Set() };
      }
      for (const id of child.ids) {
        ids.add(id);
      }
      continue;
    }

    const id = advisoryId(entry);
    if (id === null) {
      return { valid: false, ids: new Set() };
    }
    ids.add(id);
  }

  return { valid: true, ids };
}

function isAllowedPackage(packageName) {
  const trail = collectAdvisories(packageName);
  return (
    trail.valid &&
    trail.ids.size > 0 &&
    [...trail.ids].every(id => allowedAdvisories.has(id))
  );
}

const blockingPackages = Object.entries(vulnerabilities)
  .filter(
    ([, vulnerability]) =>
      (severityRank[vulnerability.severity] ?? 0) >= severityRank.high,
  )
  .map(([packageName]) => packageName)
  .filter(packageName => !isAllowedPackage(packageName));

if (blockingPackages.length > 0) {
  console.error('İzin verilmeyen high/critical dependency bulguları:');
  for (const packageName of blockingPackages) {
    console.error(`- ${packageName}: ${vulnerabilities[packageName].severity}`);
  }
  process.exit(1);
}

const acceptedPackages = Object.keys(vulnerabilities).filter(packageName =>
  isAllowedPackage(packageName),
);

if (acceptedPackages.length > 0) {
  console.warn(
    `Yaması bulunmayan iki image-size advisory zinciri geçici olarak kabul edildi (${acceptedPackages.length} paket).`,
  );
}

console.log('Production dependency audit politikası geçti.');
