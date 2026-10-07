import { describe, expect, it } from 'vitest'
import { SERVICE_WORKER_SOURCE } from '../src/service-worker.ts'

describe('Service Worker source', () => {
  it('always displays push payloads and handles same-origin clicks without caching the app', () => {
    expect(SERVICE_WORKER_SOURCE).toContain('showNotification')
    expect(SERVICE_WORKER_SOURCE).toContain('notificationclick')
    expect(SERVICE_WORKER_SOURCE).toContain('dsh-web-push/open-session')
    expect(SERVICE_WORKER_SOURCE).toContain('openWindow')
    expect(SERVICE_WORKER_SOURCE).not.toContain('caches.open')
  })

  it('renews a rotated Push subscription without a page in the loop', () => {
    expect(SERVICE_WORKER_SOURCE).toContain("addEventListener('pushsubscriptionchange'")
    expect(SERVICE_WORKER_SOURCE).toContain('event.oldSubscription')
    expect(SERVICE_WORKER_SOURCE).toContain('event.newSubscription')
    expect(SERVICE_WORKER_SOURCE).toContain('pushManager.subscribe')
    expect(SERVICE_WORKER_SOURCE).toContain('/__dsh/web-push/subscribe')
    expect(SERVICE_WORKER_SOURCE).toContain('/__dsh/web-push/unsubscribe')
    expect(SERVICE_WORKER_SOURCE).not.toContain('caches.open')
  })

  it('ships a large icon and a status-bar badge with every notification', () => {
    expect(SERVICE_WORKER_SOURCE).toContain("new URL('notification-icon.png', self.location)")
    expect(SERVICE_WORKER_SOURCE).toContain("new URL('notification-badge.png', self.location)")
    expect(SERVICE_WORKER_SOURCE).toContain('const options = { body, data, icon, badge }')
  })

  it('offers an Open action, and a Dismiss one wherever the platform has room', () => {
    expect(SERVICE_WORKER_SOURCE).toContain('self.Notification.maxActions')
    // Android's own ceiling is two, and a third action throws rather than being
    // ignored, so the cap is applied before the array is built.
    expect(SERVICE_WORKER_SOURCE).toContain('Math.min(reportedActions, 2)')
    expect(SERVICE_WORKER_SOURCE).toContain("{ action: 'open', title: 'Open' }")
    expect(SERVICE_WORKER_SOURCE).toContain("{ action: 'dismiss', title: 'Dismiss' }")
    expect(SERVICE_WORKER_SOURCE).toContain("if (event.action === 'dismiss') return;")
  })

  it('re-alerts when it replaces a row for the same session', () => {
    // The tag is stable per session and kind, so the replacement must still ring.
    expect(SERVICE_WORKER_SOURCE).toContain('options.tag = tag')
    expect(SERVICE_WORKER_SOURCE).toContain('options.renotify = true')
  })

  it('takes over the moment a rebuilt worker installs', () => {
    expect(SERVICE_WORKER_SOURCE).toContain("addEventListener('install'")
    expect(SERVICE_WORKER_SOURCE).toContain('self.skipWaiting()')
    expect(SERVICE_WORKER_SOURCE).toContain("addEventListener('activate'")
    expect(SERVICE_WORKER_SOURCE).toContain('self.clients.claim()')
  })
})
