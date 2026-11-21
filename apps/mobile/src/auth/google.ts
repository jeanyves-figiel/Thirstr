// I-03 native Sign in with Google (#25). OAuth 2.0 authorization code + PKCE in the system
// browser (ASWebAuthenticationSession), iOS client: no secret. Scope `openid` only: Google's
// ID token carries `sub`, which the server hashes (R-01.2); no email, no name, no profile.
// The client ID is public (it ships in every build); EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID overrides it.
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '613900452555-cufeuuh30tsbea8j2rcv49s0d6vjspit.apps.googleusercontent.com';

/** `com.googleusercontent.apps.<id>`: the URL scheme Google redirects back to on iOS. */
export const reversedClientId = (id: string) => id.split('.').reverse().join('.');

const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

/** Opens Google's sign-in sheet and returns its ID token. Throws Error('cancelled') when closed. */
export async function googleIdToken(clientId = GOOGLE_IOS_CLIENT_ID): Promise<string> {
  const AuthSession = await import('expo-auth-session');
  const redirectUri = `${reversedClientId(clientId)}:/oauthredirect`;
  const req = new AuthSession.AuthRequest({ clientId, redirectUri, scopes: ['openid'], usePKCE: true, extraParams: { prompt: 'select_account' } });
  const res = await req.promptAsync(discovery);
  if (res.type !== 'success' || !res.params.code) throw new Error('cancelled');
  const tok = await AuthSession.exchangeCodeAsync({ clientId, redirectUri, code: res.params.code, extraParams: { code_verifier: req.codeVerifier ?? '' } }, discovery);
  if (!tok.idToken) throw new Error('no id_token');
  return tok.idToken;
}
