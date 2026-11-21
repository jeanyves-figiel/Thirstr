// F-13 R-13.20 (#119): widget extension that only hosts the date check-in Live Activity.
// Built by @bacons/apple-targets at `expo prebuild`; signed with the app's team (CI passes DEVELOPMENT_TEAM).
// Colours from the Pop tokens (design/tokens.json).
const t = require('../../../../design/tokens.json').color;

/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'widget',
  name: 'SafetyLive',
  displayName: 'Thirstr Safety',
  bundleIdentifier: '.safetylive',
  // Live Activities with stale dates need 16.2; the app itself needs 16.4 already.
  deploymentTarget: '16.4',
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit'],
  colors: {
    $accent: t.trust.$value,
    $widgetBackground: t.bg.base.$value,
  },
};
