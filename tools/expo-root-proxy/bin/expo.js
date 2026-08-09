#!/usr/bin/env node

const path = require('path');

const workspaceRoot = path.resolve(__dirname, '../../..');
const mobileRoot = path.join(workspaceRoot, 'mobile');

let expoCli;
try {
  expoCli = require.resolve('expo/bin/cli', { paths: [mobileRoot] });
} catch {
  console.error(
    'EtkinLink Expo CLI bulunamadı. Önce "npm --prefix mobile install" komutunu çalıştırın.',
  );
  process.exit(1);
}

process.chdir(mobileRoot);
require(expoCli);
