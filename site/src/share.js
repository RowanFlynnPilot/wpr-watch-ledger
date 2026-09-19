// The address a reader should keep. Inside the WordPress iframe that is the parent
// article, which the embed exposes only through the referrer; a bare origin (default
// referrer policy) is the newsroom homepage, so the referrer is trusted only with a path.
export function pageUrl(hash = "") {
  let base;
  try {
    if (window.top === window) base = window.location.href;
    else {
      const r = document.referrer ? new URL(document.referrer) : null;
      base = r && r.pathname && r.pathname !== "/" ? r.href : window.location.href;
    }
  } catch { base = window.location.href; }
  return base.split("#")[0] + hash;
}

// Deep links: #agency=wausau-pd, #county=marathon, #place=weston
export const slug = (s) => s.toLowerCase().replace(/ county$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function readHash() {
  const m = /^#(agency|county|place)=([a-z0-9-]+)$/.exec(window.location.hash);
  return m ? { type: m[1], id: m[2] } : null;
}

export function writeHash(pick) {
  const h = pick ? `#${pick.type}=${pick.id}` : " ";
  try { window.history.replaceState(null, "", pick ? h : window.location.pathname + window.location.search); } catch { /* sandboxed frame */ }
}
