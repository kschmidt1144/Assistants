/** ⚡ Quick-actions palette — a Spotlight/⌘K launcher for the common tasks. */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { QuickAction } from "../lib/actions";

export interface QuickActionsProps {
  open: boolean;
  actions: QuickAction[];
  onClose: () => void;
}

export function QuickActions({ open, actions, onClose }: QuickActionsProps) {
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset + focus the search each time the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIdx(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(
      (a) => a.label.toLowerCase().includes(q) || a.hint?.toLowerCase().includes(q),
    );
  }, [actions, query]);

  // Keep the highlighted row in range as the filter narrows.
  useEffect(() => {
    setIdx((i) => Math.min(Math.max(0, i), Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  if (!open) return null;

  const runAt = (i: number) => {
    const a = filtered[i];
    if (a && !a.disabled) {
      a.run();
      onClose();
    }
  };

  // Step the selection, skipping disabled rows.
  const step = (dir: 1 | -1) => {
    if (filtered.length === 0) return;
    setIdx((i) => {
      let n = i;
      for (let k = 0; k < filtered.length; k += 1) {
        n = (n + dir + filtered.length) % filtered.length;
        if (!filtered[n]?.disabled) return n;
      }
      return i;
    });
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        onClose();
        break;
      case "ArrowDown":
        e.preventDefault();
        step(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        step(-1);
        break;
      case "Enter":
        e.preventDefault();
        runAt(idx);
        break;
      default:
        break;
    }
  };

  return (
    <div className="qa-backdrop" onPointerDown={onClose}>
      <div
        className="qa-palette"
        role="dialog"
        aria-label="Quick actions"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="qa-search"
          type="text"
          placeholder="Search actions…  ↑↓ to navigate · ↵ to run · esc to close"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIdx(0);
          }}
          onKeyDown={onKeyDown}
          aria-label="Search quick actions"
          role="combobox"
          aria-expanded
          aria-controls="qa-listbox"
        />
        <div className="qa-list" id="qa-listbox" role="listbox" aria-label="Quick actions">
          {filtered.length === 0 && <div className="qa-empty">No matching actions</div>}
          {filtered.map((a, i) => {
            const header = i === 0 || filtered[i - 1]?.group !== a.group;
            return (
              <Fragment key={a.id}>
                {header && <div className="qa-group">{a.group}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === idx}
                  disabled={a.disabled}
                  className={`qa-item${i === idx ? " active" : ""}`}
                  onMouseMove={() => setIdx(i)}
                  onClick={() => runAt(i)}
                >
                  <span className="qa-icon" aria-hidden>{a.icon}</span>
                  <span className="qa-text">
                    <span className="qa-label">{a.label}</span>
                    {a.hint && <span className="qa-hint">{a.hint}</span>}
                  </span>
                  {a.shortcut && <kbd className="qa-kbd">{a.shortcut}</kbd>}
                </button>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
