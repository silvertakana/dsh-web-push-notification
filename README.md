# dsh-web-push-notification

[![License](https://img.shields.io/github/license/blauerberg/dsh-web-push-notification)](LICENSE)

Receive notifications when a DeepSeek Harness task completes, stops, or needs
your approval or response.

This is a local fork. It installs as a Harness bundle and serves its own
narrow-scope Service Worker, so it coexists with a root-scope PWA Service Worker
instead of replacing it, and it works on any HTTPS origin (including a Tailscale
host name) with no public endpoint of its own.

## Install

Install the package directory as a bundle into the profile you want to notify:

```
dsh plugin --profile web install <path-to-this-package>
```

The bundle's `cordis.patch.yml` inserts the plugin and supplies the required
`vapidSubject`:

```yaml
- insert:
    - id: dsh-web-push-notification
      name: dsh-web-push-notification
      config:
        vapidSubject: 'mailto:dsh@localhost'
```

`vapidSubject` is the VAPID contact URI; use either a `mailto:` URI or an
`https:` URL, and replace the placeholder with your own address. It is
independent of the address used to open DeepSeek Harness.

VAPID keys and subscriptions are stored in `$DSH_HOME/web-push/state.json`. The
state file is deliberately outside the profile's package directory: an upgrade
or reinstall would otherwise replace it, rotate the VAPID key, and silently
orphan every subscription the browser still believes is active. Set
`storagePath` in the plugin configuration only to use another location.

Installing a bundle adds a package to the profile, so it needs a Harness
restart before the plugin loads. Restart with `dshw-restart.ps1`.

Open the profile over HTTPS unless you access it through a loopback address. On
iOS and iPadOS, add the profile to the Home Screen before enabling Web Push.

Then open **Settings → Notifications**, enable Web Push, and use **Send test**.

The test button can take optional **Title** and **Body** fields. A blank field is
passed to the server as absent, so the test notification uses the default copy (the
placeholders in those inputs show it); fill one in only to check how a custom title
or body renders on your phone. The real notifications are unaffected by these two
fields.

## Notification behavior

Each browser or installed PWA stores its notification settings separately. All
event types are enabled by default:

- Task completed
- Task stopped or failed
- Approval required
- Response required

A notification can include full content or a summary:

- **Full content** is the default and includes relevant context such as the
  latest response, question, or approval reason.
- **Summary only** omits session content. Choose it when you do not want
  notification bodies to include detailed task information.

Notification payloads are end-to-end encrypted to the subscription's `p256dh`
key, so the Push service only ever sees ciphertext even in **full** mode.

Tapping a notification focuses an existing Harness window and opens the session
the notification came from, or opens a new window at that session.

While you are already looking at Harness, nothing is pushed. Every open Harness
page reports whether it is focused, visible, and recently used to
`/__dsh/web-push/presence`, and while any page on any device is active, a
notification would only repeat what is on screen. Suppression is deliberately
global rather than per device: a focused window on the desktop is as good a
reason not to ring the phone as the phone's own screen would be.

Two things stop a forgotten page from muting you forever:

- A window nobody has touched for the configured time - ten minutes by default -
  stops counting as attention, so a desktop left open on the far side of the
  room lets the phone ring again.
- The server forgets any page that has not reported for a minute, so a tab that
  dies without a chance to say goodbye stops suppressing on its own.

**Send test** bypasses this deliberately: a test is a request for a
notification, not a report that something happened.

The judgement follows the two clients that have had to solve this exact
problem. Slack resumes mobile notifications "10 minutes after Slack stops
detecting cursor activity" (or a minute after the desktop screen locks), and
Discord exposes the same wait as its **Push Notification Inactive Timeout**. So
cursor movement counts as attention and not just clicks: reading a long answer
under a moving mouse keeps the page active, and going idle is what says you
walked away.

Both halves are yours to change in **Settings -> Notifications -> While you are
using Harness**. The quiet period can be dropped entirely, so a notification
still arrives while you are reading, and the away threshold can be set from one
to thirty minutes. They are account settings rather than per-device ones, since
the question they answer is whether you are looking at Harness anywhere; the
phone can therefore change what the desktop does. An open page adopts a new
threshold on its next report, so no reload is needed.

The notification title is the session's own title from the Harness log, so a
phone holding several sessions says which one each row belongs to. Until a
session has a title, the title falls back to the event kind.

Every notification carries the app's large icon and a monochrome status-bar
badge, served by this plugin at `/__dsh/web-push/notification-icon.png` and
`/__dsh/web-push/notification-badge.png`. Those two routes answer without the
session gate on purpose: the browser fetches a notification icon by itself, so
demanding the app cookie would silently hand back the grey placeholder disc
browsers draw for a missing icon. The files are the app's own artwork, not
state.

## Service Worker scope

The worker is served from `/__dsh/web-push/sw.js` and registered with scope
`/__dsh/web-push/`. It deliberately does not claim `/`, so it never evicts a
root-scope worker installed by a PWA plugin. A Push subscription belongs to the
worker that created it and Push events are delivered to that worker regardless
of page scope, so the narrow scope costs nothing.

The worker has no `fetch` handler and caches nothing; page loads stay with
whatever root-scope worker owns the page.

## Changes from upstream 0.1.1

- Push message TTL raised from 60 seconds to 24 hours. A phone asleep for
  longer than a minute previously lost the notification entirely, which is the
  case lock-screen notifications exist for.
- Added a `pushsubscriptionchange` handler, so a subscription the browser
  rotates is re-registered and the superseded endpoint removed instead of
  going silently stale.
- State moved from the plugin package directory to `$DSH_HOME/web-push/`.
- Subscription endpoints addressing a private, loopback, or link-local host are
  rejected, closing an SSRF path where an authenticated client could aim the
  sender at its own LAN.
- Session navigation uses `uiWorkspace.openSession` instead of the removed
  `sessions.open`, and the icon import uses an export that exists on the
  current client packages.
- Peers widened to `^0.1.2-rc.1 || ^0.2.0-rc.1`; `@deepseek-ai/dsh-api-session-controller`
  is no longer a dependency.
- The build launches TypeScript through the running Node binary, so it works on
  Windows where `node_modules/.bin/tsc` is an executable shell script.
- Notification titles name the session they came from, using the Harness session
  title; the event-kind title remains the fallback before a session has one.
- Notifications carry a large icon and a monochrome status-bar badge, so Chrome
  no longer substitutes its grey letter placeholder disc.
- The notification tag includes the session id, so two sessions reaching the
  same turn and outcome no longer collapse into one row on the phone.
- The quiet period and the away threshold are configurable in **Settings ->
  Notifications -> While you are using Harness**, and are stored by the server so
  every device agrees.
- Notifications are suppressed while a Harness page is in front of you, on any
  device: each page reports focus, visibility, and idleness, and an idle or dead
  page stops counting. Pointer movement is attention, not just clicks. The
  **Send test** button still always sends.

## License

The project is licensed under [MIT](LICENSE). See [Third-Party Notices](THIRD_PARTY_NOTICES.md) for bundled and runtime dependency notices.
