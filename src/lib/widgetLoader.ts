// Lazy loader for the self-hosted @ping-pub/widget bundle (public/widget/,
// see memory/vendored-tx-widget). It defines <ping-connect-wallet> and
// <ping-tx-dialog>, which App.vue and NavBarWallet.vue mount on every page.
//
// The bundle is ~13.7MB (signing WASM), so it used to load eagerly via a
// <script> tag in index.html on every page view, competing for bandwidth
// with the app itself and holding the browser's network-idle/tab-loading
// state for 8-10s on slower connections. It's now injected on demand instead.

let loadPromise: Promise<void> | null = null;

export function loadTxWidget(): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    if (customElements.get('ping-connect-wallet')) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.type = 'module';
    script.src = '/widget/widget.min.js';
    script.onload = () => resolve();
    script.onerror = () => {
      loadPromise = null; // allow retry on next call
      reject(new Error('Failed to load wallet widget script.'));
    };
    document.body.appendChild(script);
  });

  return loadPromise;
}

// Preload during idle time so the widget is typically ready before a user
// actually clicks Connect Wallet / Send / Delegate, without delaying the
// initial page load. Safe to call multiple times (idempotent via loadPromise).
export function preloadTxWidgetWhenIdle(): void {
  const schedule =
    typeof requestIdleCallback === 'function' ? requestIdleCallback : (cb: () => void) => setTimeout(cb, 2000);
  schedule(() => {
    loadTxWidget().catch(() => {
      // Preload is best-effort; a real user click will retry via loadTxWidget().
    });
  });
}
