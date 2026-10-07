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
    expect(SERVICE_WORKER_SOURCE).toContain('{ body, tag, data, icon, badge }')
  })
})
