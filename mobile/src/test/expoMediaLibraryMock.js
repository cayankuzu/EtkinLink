module.exports = {
  requestPermissionsAsync: async () => ({ granted: true }),
  createAssetAsync: async uri => ({ id: 'test-asset', uri }),
};
