/* eslint-env jest */
require('react-native-gesture-handler/jestSetup');

jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'MaterialCommunityIcons');
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  return {__esModule: true, default: () => null};
});
