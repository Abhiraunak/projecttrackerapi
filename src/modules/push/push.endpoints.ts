/**
 * The server sends each notification to the address the browser gave it. Only real push services are accepted,
 * so nobody can register an address inside your network and make this server call it.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge, Android, Samsung Internet, Opera
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^(?:[a-z0-9-]+\.)*notify\.windows\.com$/, // older Edge on Windows
  /^web\.push\.apple\.com$/, // Safari on Mac, iPhone and iPad
  /^(?:[a-z0-9-]+\.)*push\.apple\.com$/,
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  return PUSH_HOSTS.some((host) => host.test(url.hostname));
}
