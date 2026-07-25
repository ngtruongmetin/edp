/// <reference lib="webworker" />

import { clientsClaim, skipWaiting } from "workbox-core"
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from "workbox-precaching"
import { NavigationRoute, registerRoute, setCatchHandler } from "workbox-routing"
import { NetworkFirst } from "workbox-strategies"

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<unknown>
}

skipWaiting()
clientsClaim()

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

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((cacheName) => cacheName === "edp-navigation" || cacheName === "edp-static-assets")
          .map((cacheName) => caches.delete(cacheName)),
      ),
    ),
  )
})
