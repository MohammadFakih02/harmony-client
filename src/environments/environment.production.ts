export const environment = {
  production: true,
  apiUrl: 'https://your-railway-api-url.railway.app',
  signalRUrl: 'https://your-railway-api-url.railway.app/hubs',
  liveKitUrl: 'wss://your-livekit-url',
  // Filled in once the prod origin is added as an authorized JavaScript origin in Google Cloud
  // Console — the dev Client ID's origin allowlist doesn't cover it.
  googleClientId: ''
};