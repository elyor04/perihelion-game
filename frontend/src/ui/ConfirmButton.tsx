import { useEffect, useRef, useState } from "react";

/** Presses this soon after arming are ignored (double-clicks, held keys, bouncing A). */
export const ARM_MS = 450;

interface Props {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
}

/**
 * A destructive action that needs a second, deliberate press. The confirm
 * state is a different element (distinct key) that ignores presses for a
 * moment, so a double-click or a held Enter can never skip it.
 *
 * WebKit does not focus a button on click, so a click on the confirm button
 * can arrive with a blur whose relatedTarget is null; only a blur that moves
 * focus somewhere else cancels the confirmation.
 */
export function ConfirmButton({ label, confirmLabel, onConfirm, className = "btn" }: Props) {
  const [asking, setAsking] = useState(false);
  const shownAt = useRef(0);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!asking) return;
    shownAt.current = performance.now();
    ref.current?.focus({ preventScroll: true });
    const t = window.setTimeout(() => setAsking(false), 6000);
    return () => window.clearTimeout(t);
  }, [asking]);

  if (!asking) {
    return (
      <button key="ask" type="button" className={className} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <button
      key="confirm"
      ref={ref}
      type="button"
      className={`${className} danger`}
      aria-live="polite"
      onPointerDown={(e) => e.preventDefault()}
      onClick={(e) => {
        if (e.detail > 1 || performance.now() - shownAt.current < ARM_MS) return;
        setAsking(false);
        onConfirm();
      }}
      onKeyDown={(e) => {
        if (e.repeat) e.preventDefault();
        if (e.key === "Escape") {
          e.stopPropagation();
          setAsking(false);
        }
      }}
      onBlur={(e) => {
        if (e.relatedTarget) setAsking(false);
      }}
    >
      {confirmLabel}
    </button>
  );
}
