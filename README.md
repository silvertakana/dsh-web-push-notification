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

## License

The project is licensed under [MIT](LICENSE). See [Third-Party Notices](THIRD_PARTY_NOTICES.md) for bundled and runtime dependency notices.
