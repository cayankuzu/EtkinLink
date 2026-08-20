const { getSentryExpoConfig } = require('@sentry/react-native/metro');

/**
 * Metro configuration
 * https://docs.sentry.io/platforms/react-native/manual-setup/metro/
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = getSentryExpoConfig(__dirname, {
  // EtkinLink only ships native clients. Excluding the web replay modules keeps
  // the native dependency graph smaller and avoids resolving unused SDK code.
  includeWebReplay: false,
});

module.exports = config;
