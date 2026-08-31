const { spawnSync } = require('node:child_process');
const path = require('node:path');

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

const blockingPackages = Object.entries(vulnerabilities)
  .filter(
    ([, vulnerability]) =>
      (severityRank[vulnerability.severity] ?? 0) >= severityRank.high,
  )
  .map(([packageName]) => packageName);

if (blockingPackages.length > 0) {
  console.error('İzin verilmeyen high/critical dependency bulguları:');
  for (const packageName of blockingPackages) {
    console.error(`- ${packageName}: ${vulnerabilities[packageName].severity}`);
  }
  process.exit(1);
}

console.log('Production dependency audit politikası geçti.');
