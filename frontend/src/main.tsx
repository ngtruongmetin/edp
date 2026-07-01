import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./index.css"

import { AuthProvider } from "./auth/AuthContext"

function isZaloWebView() {
  const ua = String(navigator.userAgent || "").toLowerCase()
  return ua.includes("zalo")
}

function isAndroid() {
  const ua = String(navigator.userAgent || "").toLowerCase()
  return ua.includes("android")
}

function tryOpenInChromeAndroid(url: string) {
  // Best-effort: use Android intent to open in Chrome.
  // If Chrome isn't available, Android should fall back via browser_fallback_url.
  const clean = url.replace(/^https?:\/\//i, "")
  const scheme = url.startsWith("https://") ? "https" : "http"
  const intent =
    `intent://${clean}` +
    `#Intent;scheme=${scheme};package=com.android.chrome;` +
    `S.browser_fallback_url=${encodeURIComponent(url)};end`
  window.location.href = intent
}

;(function guardZaloWebView() {
  if (!isZaloWebView()) return

  const url = window.location.href
  const attemptedKey = "edp_zalo_open_attempted"
  const attempted = sessionStorage.getItem(attemptedKey) === "1"

  // Try once per session to avoid redirect loops.
  if (!attempted && isAndroid()) {
    sessionStorage.setItem(attemptedKey, "1")
    tryOpenInChromeAndroid(url)
  }

  // If still in Zalo WebView, show guidance page.
  window.setTimeout(() => {
    if (!isZaloWebView()) return
    const u = encodeURIComponent(url)
    const target = `/open-in-browser?u=${u}`
    if (window.location.pathname !== "/open-in-browser") {
      window.location.replace(target)
    }
  }, 700)
})()

ReactDOM.createRoot(document.getElementById("root")!).render(

  <React.StrictMode>

    <AuthProvider>

      <App/>

    </AuthProvider>

  </React.StrictMode>

)
