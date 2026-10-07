import { pushHeadersOf } from './notification.ts'
import type { NotificationKind, PushSubscriptionRecord } from './types.ts'
import type { PushSender } from './sender.ts'
import type { PushStore } from './store.ts'

export interface DeliveryReport {
  readonly sent: number
  readonly removed: number
  readonly failed: number
}

export type PushPayloadFactory = (subscription: PushSubscriptionRecord) => unknown

export interface DeliveryOptions {
  /** When set, only subscriptions whose preferences enable this kind receive the payload. */
  readonly kind?: NotificationKind
  /**
   * Extra per-subscription gate, applied beside the kind gate. A payload only
   * some devices asked for - a subagent's own turn, say - is filtered here,
   * because the caller building the payload cannot see one device's choices.
   */
  readonly wants?: (subscription: PushSubscriptionRecord) => boolean
  readonly onFailure?: (status: number | undefined) => void
  /** Built per subscription, so one device can receive a different body than its peers. */
  readonly payloadFor?: PushPayloadFactory
}

/** Aggregate counters keep Push endpoints out of route responses and logs. */
export async function deliver(
  store: PushStore,
  sender: PushSender,
  payload: unknown,
  options: DeliveryOptions = {},
): Promise<DeliveryReport> {
  const { kind, wants, onFailure, payloadFor } = options
  const serializedPayload = JSON.stringify(payload)
  if (serializedPayload === undefined) throw new Error('push payload is not JSON-serializable')
  let sent = 0
  let removed = 0
  let failed = 0
  for (const subscription of store.list()) {
    if (kind !== undefined && !subscription.preferences[kind]) continue
    if (wants !== undefined && !wants(subscription)) continue
    try {
      const built = payloadFor === undefined ? payload : payloadFor(subscription)
      const serialized = payloadFor === undefined ? serializedPayload : JSON.stringify(built)
      if (serialized === undefined) throw new Error('push payload is not JSON-serializable')
      await sender.send(subscription, serialized, pushHeadersOf(built))
      sent++
    } catch (error) {
      const status = errorStatus(error)
      onFailure?.(status)
      if (status === 404 || status === 410) {
        if (store.remove(subscription.endpoint)) removed++
      } else {
        failed++
      }
    }
  }
  return { sent, removed, failed }
}

function errorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const statusCode = (error as { statusCode?: unknown }).statusCode
  return typeof statusCode === 'number' ? statusCode : undefined
}
