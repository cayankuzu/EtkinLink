module.exports = {
  cacheDirectory: 'file://test-cache/',
  downloadAsync: async (_source, destination) => ({
    uri: destination,
    status: 200,
  }),
  readAsStringAsync: async () => {
    throw new Error('File not found');
  },
  writeAsStringAsync: async () => undefined,
};
