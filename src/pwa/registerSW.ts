export function registerServiceWorker(): void {
  if (import.meta.env.PROD) {
    void import("virtual:pwa-register").then(({ registerSW }) => {
      registerSW({ immediate: true });
    });
  }
}
