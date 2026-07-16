/// <reference lib="webworker" />

import { clientsClaim } from "workbox-core"
import { createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching"
import { registerRoute, NavigationRoute } from "workbox-routing"
import { CacheFirst } from "workbox-strategies"
import { CacheableResponsePlugin } from "workbox-cacheable-response"
import { ExpirationPlugin } from "workbox-expiration"

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<unknown>
}

clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)

registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html")))

registerRoute(
  ({ request }) =>
    request.destination === "style" ||
    request.destination === "font" ||
    request.destination === "script" ||
    request.destination === "image" ||
    request.destination === "manifest",
  new CacheFirst({
    cacheName: "edp-static-assets",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 30,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
    ],
  }),
)

self.addEventListener("install", () => {
  self.skipWaiting()
})
