import { ReactNode, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

export function focusablesIn(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Modal dialog: focuses its first control (or [data-autofocus]), keeps Tab
 * inside itself even when focus has wandered to <body>, and returns focus
 * to where it was when it closes.
 */
// The last element that had focus. Opening a dialog makes the screen behind
// it inert, which drops focus to <body> before the dialog mounts, so the
// dialog uses this to know where to return.
let lastFocused: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener("focusin", (e) => {
    if (e.target instanceof HTMLElement && e.target !== document.body) lastFocused = e.target;
  });
}

export function Dialog({ labelledBy, className = "", children }: { labelledBy: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Captured during the first render, before the screen behind turns inert.
  const [prev] = useState(() => {
    const active = document.activeElement as HTMLElement | null;
    return active && active !== document.body ? active : lastFocused;
  });
  useEffect(() => {
    const root = ref.current;
    const first = root?.querySelector<HTMLElement>("[data-autofocus]") ?? focusablesIn(root)[0];
    first?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !ref.current) return;
      const items = focusablesIn(ref.current);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && ref.current.contains(active);
      const i = inside ? items.indexOf(active!) : -1;
      e.preventDefault();
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i < 0 || i >= items.length - 1 ? 0 : i + 1;
      items[next].focus();
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      // Wait a frame: the screen behind is still `inert` while this unmounts.
      requestAnimationFrame(() => {
        if (prev && document.contains(prev) && !prev.closest("[inert], .hud") && !document.querySelector("[role=dialog]")) prev.focus({ preventScroll: true });
      });
    };
  }, [prev]);
  return (
    <div className="scrim" data-nav-root>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy} className={`dialog ${className}`}>
        {children}
      </div>
    </div>
  );
}

/** Four-pointed star used for ratings. */
export function StarGlyph({ on, size = 18, className = "" }: { on: boolean; size?: number; className?: string }) {
  return (
    <svg className={`star ${on ? "on" : "off"} ${className}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 1.5 L14.6 9.4 L22.5 12 L14.6 14.6 L12 22.5 L9.4 14.6 L1.5 12 L9.4 9.4 Z" />
    </svg>
  );
}

export function Stars({ n, size = 16, className = "" }: { n: number; size?: number; className?: string }) {
  const { t } = useI18n();
  return (
    <span className={`stars ${className}`} role="img" aria-label={t("a11y.starsOf", { n })}>
      {[0, 1, 2].map((i) => (
        <StarGlyph key={i} on={i < n} size={size} />
      ))}
    </span>
  );
}

export function Icon({ name }: { name: "pause" | "restart" | "back" | "lock" }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", "aria-hidden": true, focusable: false } as const;
  switch (name) {
    case "pause":
      return (
        <svg {...common}>
          <rect x="6.5" y="5" width="3.5" height="14" rx="1" />
          <rect x="14" y="5" width="3.5" height="14" rx="1" />
        </svg>
      );
    case "restart":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5" />
          <path d="M4 4.5v4.2h4.2" />
        </svg>
      );
    case "back":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.5 5.5 8 12l6.5 6.5" />
        </svg>
      );
    case "lock":
      return (
        <svg {...common} width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="5.5" y="10.5" width="13" height="9" rx="1.5" />
          <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
        </svg>
      );
  }
}

/** <kbd> hint for a key or gamepad button. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}
