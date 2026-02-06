// Content script bridge — injects into matching web pages.
// Relays messages between page and extension background via CustomEvents.

(() => {
  // Relay page → extension
  window.addEventListener("vlc-bridge-request", async (event) => {
    const { _reqId, ...message } = event.detail || {};
    try {
      const response = await chrome.runtime.sendMessage(message);
      window.dispatchEvent(
        new CustomEvent("vlc-bridge-response", { detail: { _reqId, ...response } })
      );
    } catch (err) {
      window.dispatchEvent(
        new CustomEvent("vlc-bridge-response", {
          detail: { _reqId, success: false, error: err.message, code: "EXTENSION_ERROR" },
        })
      );
    }
  });

  // Port-based connection for push status updates
  let port = null;
  window.addEventListener("vlc-bridge-connect", () => {
    if (port) return;
    try {
      port = chrome.runtime.connect();
      port.onMessage.addListener((message) => {
        window.dispatchEvent(
          new CustomEvent("vlc-bridge-push", { detail: message })
        );
      });
      port.onDisconnect.addListener(() => {
        port = null;
        window.dispatchEvent(
          new CustomEvent("vlc-bridge-push", {
            detail: { type: "disconnected" },
          })
        );
      });
    } catch (err) {
      window.dispatchEvent(
        new CustomEvent("vlc-bridge-push", {
          detail: { type: "error", error: err.message },
        })
      );
    }
  });

  window.addEventListener("vlc-bridge-disconnect", () => {
    if (port) { port.disconnect(); port = null; }
  });

  window.addEventListener("vlc-bridge-port-message", (event) => {
    if (port) port.postMessage(event.detail);
  });

  // Announce presence
  window.dispatchEvent(
    new CustomEvent("vlc-bridge-available", { detail: { version: "1.0.0" } })
  );
})();
