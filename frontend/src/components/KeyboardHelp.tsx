/**
 * KeyboardHelp — global `?` overlay that lists every keyboard shortcut.
 * Listens for `?` on window keydown; ignores the key when the event target
 * is an <input>, <textarea>, or a `contentEditable` node so it doesn't
 * hijack typing. Built on the Radix Dialog primitive so focus trap and
 * Escape-to-close come for free.
 */
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { C } from "../utils/theme";

interface Shortcut {
  keys: string[];
  desc: string;
}

interface Group {
  label: string;
  items: Shortcut[];
}

const GROUPS: Group[] = [
  {
    label: "Global",
    items: [
      { keys: ["Cmd", "K"], desc: "Open command palette" },
      { keys: ["?"],        desc: "Show this keyboard shortcut help" },
      { keys: ["Esc"],      desc: "Close dialogs, palette, or drawer" },
    ],
  },
  {
    label: "Command palette",
    items: [
      { keys: ["↑", "↓"],   desc: "Move selection" },
      { keys: ["Enter"],    desc: "Open the selected result" },
      { keys: ["Esc"],      desc: "Close palette" },
    ],
  },
  {
    label: "Tables (pods, nodes, incidents)",
    items: [
      { keys: ["↑", "↓"],   desc: "Move between rows" },
      { keys: ["Enter"],    desc: "Open row details" },
      { keys: ["Space"],    desc: "Open row details" },
    ],
  },
  {
    label: "AI chat",
    items: [
      { keys: ["Enter"],           desc: "Send message" },
      { keys: ["Shift", "Enter"],  desc: "New line" },
      { keys: ["Esc"],             desc: "Cancel edit" },
    ],
  },
  {
    label: "Dashboard cards",
    items: [
      { keys: ["Enter"],    desc: "Expand / collapse card" },
      { keys: ["Space"],    desc: "Expand / collapse card" },
    ],
  },
];

/** Returns true when the event originated from an editable element. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function KeyboardHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "?") return;
      if (isTyping(e.target)) return;
      e.preventDefault();
      setOpen(o => !o);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px 28px", marginTop: 16 }}>
          {GROUPS.map(group => (
            <div key={group.label}>
              <div style={{
                fontSize: 11, textTransform: "uppercase", letterSpacing: ".6px",
                color: C.text.faint, fontWeight: 700, marginBottom: 10,
              }}>
                {group.label}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {group.items.map((item, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ fontSize: 12, color: C.text.secondary, lineHeight: 1.4 }}>{item.desc}</span>
                    <span style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      {item.keys.map((k, j) => (
                        <kbd key={j} style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          minWidth: 22, height: 22, padding: "0 6px",
                          fontSize: 11, fontFamily: "'Cascadia Code','Consolas',monospace", fontWeight: 600,
                          color: C.text.primary,
                          background: C.bg.elevated,
                          border: `1px solid ${C.border.muted}`,
                          borderRadius: 4,
                          boxShadow: `0 1px 0 ${C.border.subtle}`,
                        }}>
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 20, paddingTop: 14, borderTop: `1px solid ${C.border.subtle}`, fontSize: 11, color: C.text.faint, textAlign: "center" }}>
          Press <kbd style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            minWidth: 18, height: 18, padding: "0 5px", margin: "0 3px",
            fontSize: 10, fontFamily: "'Cascadia Code','Consolas',monospace", fontWeight: 600,
            color: C.text.primary, background: C.bg.elevated,
            border: `1px solid ${C.border.muted}`, borderRadius: 3,
          }}>?</kbd> any time to reopen this.
        </div>
      </DialogContent>
    </Dialog>
  );
}
