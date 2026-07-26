/// <reference lib="webworker" />

import { clientsClaim, skipWaiting } from "workbox-core"
import { CacheableResponsePlugin } from "workbox-cacheable-response"
import { ExpirationPlugin } from "workbox-expiration"
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from "workbox-precaching"
import { NavigationRoute, registerRoute, setCatchHandler } from "workbox-routing"
import { NetworkFirst, StaleWhileRevalidate } from "workbox-strategies"

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<unknown>
}

skipWaiting()
clientsClaim()

registerRoute(
  ({ request, url }) =>
    request.method === "GET" &&
    url.origin === self.location.origin &&
    url.pathname === "/api/classes",
  new StaleWhileRevalidate({
    cacheName: "edp-public-classes",
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({
        maxEntries: 1,
        maxAgeSeconds: 7 * 24 * 60 * 60,
        purgeOnQuotaError: true,
      }),
    ],
  }),
)

// Navigation must prefer the deployed HTML, while the precached shell remains
// available as an offline fallback.
registerRoute(
  new NavigationRoute(
    new NetworkFirst({ cacheName: "edp-navigation" }),
    { denylist: [/^\/api\//] },
  ),
)

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

setCatchHandler(async ({ request }) => {
  if (request.mode === "navigate") {
    const offlineShell = await matchPrecache("/index.html")
    if (offlineShell) return offlineShell
  }

  return Response.error()
})
