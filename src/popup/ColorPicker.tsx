import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PALETTE_ROWS } from "../shared/colors";

type EyeDropperCtor = new () => { open(): Promise<{ sRGBHex: string }> };

interface Props {
  value: string;
  onChange: (color: string) => void;
  /** open the popover above the trigger (for controls near the popup bottom) */
  direction?: "up" | "down";
  title?: string;
}

export function ColorPicker({ value, onChange, direction = "down", title }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const toggleOpen = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const popWidth = 246;
      const popHeight = 205;

      let left = rect.right - popWidth;
      if (left < 10) left = 10;
      if (left + popWidth > window.innerWidth - 10) left = window.innerWidth - popWidth - 10;

      let top = direction === "up" ? rect.top - popHeight - 8 : rect.bottom + 8;
      if (top + popHeight > window.innerHeight - 10) {
        top = rect.top - popHeight - 8;
      }
      if (top < 10) top = 10;

      setPopPos({ top, left });
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const pickFromScreen = async (): Promise<void> => {
    const ctor = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
    if (!ctor) return;
    try {
      const res = await new ctor().open();
      onChange(res.sRGBHex);
      setOpen(false);
    } catch {
      // user cancelled
    }
  };

  const popoverContent = open && popPos && (
    <div
      ref={popoverRef}
      className="cp-pop-portal"
      style={{
        position: "fixed",
        top: `${popPos.top}px`,
        left: `${popPos.left}px`,
        zIndex: 9999,
      }}
    >
      {PALETTE_ROWS.map((row, i) => (
        <div key={i} className="cp-row">
          {row.map((c) => (
            <button
              key={c}
              type="button"
              className={c.toLowerCase() === value.toLowerCase() ? "swatch selected" : "swatch"}
              style={{ background: c }}
              title={c}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
            />
          ))}
        </div>
      ))}
      <div className="cp-custom">
        <label className="cp-custom-input">
          <input
            type="color"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
            }}
          />
          <span>Custom</span>
        </label>
        {(window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper && (
          <button
            type="button"
            className="cp-eyedropper-btn"
            onClick={() => void pickFromScreen()}
            title="Sample color from screen"
          >
            <span style={{ fontSize: "12px" }}>💧</span>
            <span>EyeDropper</span>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="cp-root">
      <button
        ref={triggerRef}
        type="button"
        className="cp-trigger"
        title={title ?? "Pick a color"}
        onClick={toggleOpen}
      >
        <span className="dot" style={{ background: value }} />
      </button>
      {open && typeof document !== "undefined" && createPortal(popoverContent, document.body)}
    </div>
  );
}
