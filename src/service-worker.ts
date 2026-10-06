export const SERVICE_WORKER_SOURCE: string = `
const fallback = { title: 'DeepSeek Harness', body: 'A notification is ready.' };

function payloadOf(event) {
  if (!event.data) return fallback;
  try {
    const value = event.data.json();
    if (value && typeof value === 'object') return value;
  } catch (_) {
    // Invalid payloads still produce a visible notification.
  }
  return fallback;
}

self.addEventListener('push', (event) => {
  const value = payloadOf(event);
  const title = typeof value.title === 'string' && value.title !== '' ? value.title : fallback.title;
  const body = typeof value.body === 'string' ? value.body : fallback.body;
  const tag = typeof value.tag === 'string' && value.tag !== '' ? value.tag : undefined;
  const data = {
    url: typeof value.url === 'string' ? value.url : '/',
    sessionId: typeof value.sessionId === 'string' ? value.sessionId : undefined,
  };
  event.waitUntil(self.registration.showNotification(title, { body, tag, data }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.url;
  let target = self.location.origin + '/';
  try {
    const url = new URL(typeof raw === 'string' ? raw : '/', self.location.origin);
    if (url.origin === self.location.origin) target = url.href;
  } catch (_) {
    // Keep the same-origin root for malformed click data.
  }
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => {
      try { return new URL(client.url).origin === self.location.origin; } catch (_) { return false; }
    });
    const sessionId = event.notification.data && event.notification.data.sessionId;
    if (existing) {
      if (typeof sessionId === 'string' && sessionId !== '') {
        existing.postMessage({ type: 'dsh-web-push/open-session', sessionId });
      }
      return existing.focus();
    }
    return self.clients.openWindow(target);
  }));
});

function base64UrlToBytes(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function post(path, body) {
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// A browser silently rotates a Push subscription over time. Without this the
// saved endpoint goes stale and delivery stops with no visible symptom, so the
// worker renews itself and retires the endpoint it replaced.
self.addEventListener('pushsubscriptionchange', (event) => {
  const previous = event.oldSubscription;
  event.waitUntil((async () => {
    try {
      let next = event.newSubscription;
      if (!next) {
        const response = await fetch('/__dsh/web-push/config', { credentials: 'same-origin' });
        const config = await response.json();
        next = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(config.publicKey),
        });
      }
      await post('/__dsh/web-push/subscribe', next.toJSON());
      if (previous && previous.endpoint !== next.endpoint) {
        await post('/__dsh/web-push/unsubscribe', { endpoint: previous.endpoint });
      }
    } catch (_) {
      // A failed renewal leaves a stale record behind; the settings section
      // reconciles the subscription again on the next visit.
    }
  })());
});
`
