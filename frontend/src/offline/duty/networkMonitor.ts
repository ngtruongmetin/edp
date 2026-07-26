export type NetworkListener = (online: boolean) => void

export class NetworkMonitor {
  private listeners = new Set<NetworkListener>()

  readonly handleOnline = () => this.emit(true)
  readonly handleOffline = () => this.emit(false)

  constructor() {
    window.addEventListener("online", this.handleOnline)
    window.addEventListener("offline", this.handleOffline)
  }

  get isOnline() {
    return navigator.onLine
  }

  subscribe(listener: NetworkListener) {
    this.listeners.add(listener)
    listener(this.isOnline)
    return () => {
      this.listeners.delete(listener)
    }
  }

  destroy() {
    window.removeEventListener("online", this.handleOnline)
    window.removeEventListener("offline", this.handleOffline)
    this.listeners.clear()
  }

  private emit(online: boolean) {
    this.listeners.forEach((listener) => listener(online))
  }
}
