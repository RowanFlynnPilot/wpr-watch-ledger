import { useEffect, useRef, useState } from "react";

// Edge fades + swipe hint for a sideways-scrolling table, shown only while there is actually
// more table to scroll to. Returns the ref for the scroll box and which edges have more.
export default function useOverflow() {
  const ref = useRef(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () =>
      setOverflow((prev) => {
        const left = el.scrollLeft > 4;
        const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
        return prev.left === left && prev.right === right ? prev : { left, right };
      });
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return [ref, overflow];
}
