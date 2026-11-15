// PhishGuard trigger → redirect bridge.
//
// On a deployed campaign server this reads campaign.json (written next to the
// extension at deploy time) and watches for the configured trigger action on
// the modified site. When it fires, it emits a redirect SIGNAL through the VNC
// clipboard; the noVNC client page (pgvnc.html) catches it and navigates the
// viewer's own browser to the redirect target, leaving the noVNC session.
//
// On the local preview there is no campaign.json, so this does nothing.
(() => {
  "use strict";

  const SIGNAL_PREFIX = "PHISHGUARD_REDIRECT::";

  function toClipboard(text) {
    try {
      navigator.clipboard.writeText(text).catch(fallback);
      return;
    } catch (_) { fallback(); }
    function fallback() {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      } catch (_) {}
    }
  }

  let fired = false;
  function fire(cfg) {
    if (fired) return;
    fired = true;
    toClipboard(SIGNAL_PREFIX + JSON.stringify({
      type: cfg.redirect_type || "url",
      target: cfg.redirect_target || "",
    }));
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
      case "pageload":
        setTimeout(go, 1500);
        break;
      case "login":
      case "submit":
        document.addEventListener("submit", go, true);
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
      default: // be forgiving: any submit or primary-control click
        document.addEventListener("submit", go, true);
        document.addEventListener("click", (e) => {
          if (e.target.closest && e.target.closest("button,a,[type=submit]")) go();
        }, true);
    }
  }

  init();
})();
