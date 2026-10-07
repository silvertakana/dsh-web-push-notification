import type { NotificationPreferences } from './types.ts'

export interface WebPushConfig {
  readonly publicKey: string
  readonly serviceWorkerUrl: string
  readonly serviceWorkerScope: string
}

export interface PushSubscriptionJson {
  readonly endpoint: string
  readonly expirationTime?: number | null
  readonly keys?: {
    readonly p256dh?: string
    readonly auth?: string
  }
  readonly preferences?: NotificationPreferences
}

/**
 * Route prefix shared with the browser bundle. It lives here rather than in
 * routes.ts because that module imports node:fs, and the client bundle must
 * never pull a Node built-in into the page.
 */
export const WEB_PUSH_ROUTE_PREFIX = '/__dsh/web-push'

/** Where a live page reports whether it is focused, visible and recently used. */
export const PRESENCE_PATH = `${WEB_PUSH_ROUTE_PREFIX}/presence`
