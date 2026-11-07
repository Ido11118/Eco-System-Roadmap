"use client";
import { useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import { fittingBarFont, MIN_BAR_FONT } from "@/lib/barText";
import { fitsTwoLines } from "./geometry";

/** Measure actual glyphs and available space, including badges and RTL fonts. */
export function BarLabel({ text, height, maximum, fit }: { text: string; height: number; maximum: number; fit: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const max = Math.max(MIN_BAR_FONT, maximum);
  const [size, setSize] = useState(max);
  useLayoutEffect(() => {
    if (!fit) { setSize(max); return; }
    const label = ref.current;
    const bar = label?.closest<HTMLElement>(".gantt-bar, .plan-dash");
    const parent = label?.parentElement;
    if (!label || !bar || !parent) return;
    const probe = document.createElement("span");
    probe.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;display:block;line-height:1.2;overflow-wrap:break-word;";
    probe.textContent = text;
    let active = true, frame = 0;
    const measure = () => {
      if (!active) return;
      const css = getComputedStyle(label), p = getComputedStyle(parent);
      const siblings = [...parent.children].filter((el) => el !== label) as HTMLElement[];
      const width = Math.max(0, bar.clientWidth - parseFloat(p.paddingLeft || "0") - parseFloat(p.paddingRight || "0")
        - siblings.reduce((n, el) => n + el.offsetWidth, 0) - (parseFloat(p.columnGap) || 0) * siblings.length);
      if (width <= 0) { setSize(MIN_BAR_FONT); return; }
      Object.assign(probe.style, { fontFamily: css.fontFamily, fontWeight: css.fontWeight, fontStyle: css.fontStyle, letterSpacing: css.letterSpacing, width: `${width}px` });
      document.body.appendChild(probe);
      let next: number;
      try { next = fittingBarFont(max, (candidate) => {
        const lines = fitsTwoLines(height, candidate) ? 2 : 1;
        probe.style.fontSize = `${candidate}px`;
        probe.style.whiteSpace = lines === 2 ? "normal" : "nowrap";
        // scrollHeight includes glyph overhang (not extra lines). Use the line
        // box to count wraps, and separately check actual ink against bar height.
        return probe.scrollWidth <= width + 0.5 && probe.clientHeight <= candidate * 1.2 * lines + 1 && probe.scrollHeight <= height - 4 + 1;
      }); } finally { probe.remove(); }
      setSize((old) => old === next ? old : next);
    };
    const schedule = () => { if (active) { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); } };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(bar); observer.observe(parent); observer.observe(label);
    void document.fonts.ready.then(schedule);
    document.fonts.addEventListener("loadingdone", schedule);
    return () => { active = false; observer.disconnect(); cancelAnimationFrame(frame); document.fonts.removeEventListener("loadingdone", schedule); probe.remove(); };
  }, [text, height, max, fit]);
  const font = fit ? Math.min(max, Math.max(MIN_BAR_FONT, size)) : max;
  return <span ref={ref} data-bar-label data-fitted={fit || undefined}
    className={clsx("min-w-0", fitsTwoLines(height, font) ? "line-clamp-2 whitespace-normal break-words leading-[1.2]" : "truncate")}
    style={{ fontSize: font, ...(fit ? { lineHeight: 1.2 } : {}) }}>{text}</span>;
}
