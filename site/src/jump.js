// Scroll a section into view. Sections below the map use content-visibility: auto, so a smooth
// scroll is planned against their estimated heights and can end a little off once they render
// on the way past. When the scroll settles, snap the last few pixels. Reduced motion jumps.
export function jumpTo(target) {
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  let done = false;
  const settle = () => {
    if (done) return;
    done = true;
    const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    if (Math.abs(el.getBoundingClientRect().top - margin) > 4) el.scrollIntoView({ block: "start" });
  };
  window.addEventListener("scrollend", settle, { once: true });
  setTimeout(settle, 1500); // browsers without scrollend
}
