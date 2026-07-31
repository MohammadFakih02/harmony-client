// API + SignalR are addressed with SAME-ORIGIN RELATIVE paths. In the Docker
// image nginx reverse-proxies /api and /hubs to the API container; for `ng serve`
// the dev server proxies them to http://localhost:5057 via proxy.conf.json. This
// keeps the built bundle hostname-free, so it works behind any origin (localhost,
// a Cloudflare tunnel, a real domain) with no rebuild.
export const environment = {
  production: false,
  apiUrl: '/api',
  signalRUrl: '/hubs',
  liveKitUrl: 'ws://localhost:7880',
  googleClientId: '249656440062-8uqu5rk0vsft4m6ijgqon4llrdq41h3d.apps.googleusercontent.com'
};