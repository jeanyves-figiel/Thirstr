// I-01 R-I01.1 (#17): share extension. Takes a link (or text with a link) from any app's share
// sheet and hands it to Thirstr as thirstr://share?url=…; the app opens the S-44 share sheet after
// App lock. No App Group and no storage here: the link lives only in that one URL hand-off.
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'share',
  name: 'ShareLink',
  displayName: 'Thirstr',
  bundleIdentifier: '.share',
  deploymentTarget: '16.4',
  entitlements: {},
  frameworks: ['UIKit', 'UniformTypeIdentifiers'],
};
