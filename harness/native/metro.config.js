// Expo's Metro config, plus THE FLAG.
//
// Metro resolves package exports by default since React Native 0.79 / Expo 53,
// asserting `react-native` for the native platforms — so on android and ios
// nothing here is needed: `@12-apps/ui/form/Button` takes the native build
// because its exports map lists that condition ahead of `default`.
//
// On web, Metro asserts `browser` instead, and the same import would resolve to
// the MUI build. This harness wants the NATIVE renderer in the browser (that is
// what Playwright can look at), so `react-native` is added to the conditions
// for every platform. This is the one line a react-native-web app writes to
// force the native renderer on the web; leave it out and the web gets MUI.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['react-native', 'require', 'import'];

module.exports = config;
