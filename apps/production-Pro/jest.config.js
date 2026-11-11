module.exports = {
  preset: 'react-native',
  setupFiles: ['./jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native|@react-navigation|react-native-gesture-handler|react-native-safe-area-context|react-native-linear-gradient|@tanstack)/)',
  ],
};
