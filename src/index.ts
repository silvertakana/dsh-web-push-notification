import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { deliver } from './delivery.ts'
import { notificationForEvent, sessionTitleOf } from './notification.ts'
import { createPushRoutes } from './routes.ts'
import { createWebPushSender, generateVapidKeys } from './sender.ts'
import { PushStore } from './store.ts'

export const name = 'dsh-web-push-notification'

export const inject = ['connection', 'webServer', 'sessions']

/** Contact URI a Push service can use to reach the deployment owner. */
export const DEFAULT_VAPID_SUBJECT = 'mailto:dsh@localhost'

/** Cap on a subscription request body: two keys plus preferences is far smaller. */
export const DEFAULT_MAX_REQUEST_BODY_BYTES = 64 * 1024

/**
 * Every field is optional, and the exported schema is deliberately NOT asserted
 * back onto this interface with `z<Config>`.
 *
 * From cosmokit 1.8.5 on, a schemastery field's output type also carries
 * `Volatile`, the lazy-reference type the config loader resolves, and `Volatile`
 * is a real runtime export the Harness packages require. A required or
 * defaulted scalar field can therefore no longer satisfy `z<Config>`, which is
 * the annotation upstream used. The Loader validates and defaults against the
 * exported schema before `apply` runs, so the plugin reads plain values here and
 * carries its own fallback for each one.
 */
export interface Config {
  vapidSubject?: string
  storagePath?: string
  maxRequestBodyBytes?: number
}

export const Config = z.object({
  vapidSubject: z.string().default(DEFAULT_VAPID_SUBJECT),
  storagePath: z.string(),
  maxRequestBodyBytes: z.natural().min(1024).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
})

/**
 * Storage lives under the Harness home, never beside the installed bundle: a
 * profile install owns the package directory, so reinstalling or upgrading
 * would replace the state file, rotate the VAPID key, and silently orphan
 * every subscription the browser still believes is active.
 */
export function defaultStoragePath(): string {
  return dshHomePath('web-push', 'state.json')
}

export function apply(ctx: Context, config?: Config): void {
  const subject = config?.vapidSubject ?? DEFAULT_VAPID_SUBJECT
  const storagePath = config?.storagePath ?? defaultStoragePath()
  const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  const store = PushStore.open(storagePath, generateVapidKeys)
  const sender = createWebPushSender(subject, {
    publicKey: store.publicKey,
    privateKey: store.privateKey,
  })
  const onDeliveryFailure = (status: number | undefined): void => {
    ctx.logger.warn(
      new Error(`dsh-web-push-notification: delivery failed${status === undefined ? '' : ` (${String(status)})`}`),
    )
  }
  const routes = createPushRoutes({
    store,
    sender,
    maxRequestBodyBytes,
    requestRejection: (request) => ctx.connection.requestRejection(request),
    onDeliveryFailure,
  })
  ctx.effect(() => {
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-web-push-notification: routes')
  ctx.effect(() => {
    const dispose = ctx.on('session/event', (session: Session, event: SessionEvent) => {
      const events = session.snapshotEvents()
      const sessionTitle = sessionTitleOf(events)
      const summary = notificationForEvent(String(session.id), event, { bodyMode: 'summary', events, sessionTitle })
      if (summary === undefined) return
      void deliver(
        store,
        sender,
        summary,
        summary.kind,
        onDeliveryFailure,
        (subscription) =>
          notificationForEvent(String(session.id), event, {
            bodyMode: subscription.preferences.bodyMode,
            events,
            sessionTitle,
          }) ?? summary,
      ).catch((error) => {
        ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
      })
    })
    return dispose
  }, 'dsh-web-push-notification: session notifications')
}
