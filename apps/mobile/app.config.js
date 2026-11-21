// Per-build values on top of app.json. The API host doubles as the passkey relying party,
// so the iOS app must claim it as an associated domain (webcredentials, I-03). Profile share
// links (I-02) open in the app from the site host (applinks, `/p/*`).
// #25 I-03: Google redirects back through the reversed iOS client ID (public, not a secret).
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '613900452555-cufeuuh30tsbea8j2rcv49s0d6vjspit.apps.googleusercontent.com';
const googleScheme = GOOGLE_IOS_CLIENT_ID.split('.').reverse().join('.');

module.exports = ({ config }) => {
  const api = process.env.EXPO_PUBLIC_API_URL;
  const host = api ? new URL(api).host : null;
  const site = host ? host.replace(/^api\./, '') : null;
  return {
    ...config,
    ios: {
      ...config.ios,
      // CI sets IOS_BUILD_NUMBER (run number + offset); TestFlight needs it to grow.
      ...(process.env.IOS_BUILD_NUMBER ? { buildNumber: process.env.IOS_BUILD_NUMBER } : {}),
      associatedDomains: host ? [`webcredentials:${host}`, `applinks:${site}`] : [],
      // #119: the Live Activity extension (targets/safety-live) signs with the same team; CI has APPLE_TEAM_ID.
      ...(process.env.APPLE_TEAM_ID ? { appleTeamId: process.env.APPLE_TEAM_ID } : {}),
      infoPlist: {
        ...config.ios?.infoPlist,
        CFBundleURLTypes: [...(config.ios?.infoPlist?.CFBundleURLTypes ?? []), { CFBundleURLSchemes: [googleScheme] }],
      },
    },
  };
};
