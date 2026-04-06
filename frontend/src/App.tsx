import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import type { Target } from "./types";
import { api }        from "./api/client";
import { Sidebar }    from "./components/Sidebar";
import { Home }       from "./pages/Home";
import { Dashboard }  from "./pages/Dashboard";
import { Alerts }     from "./pages/Alerts";
import { History }    from "./pages/History";
import { Chat }       from "./pages/Chat";
import { AddTargetModal } from "./components/AddTargetModal";
import { CommandPalette } from "./components/CommandPalette";
import { ThemeProvider }  from "./components/ThemeContext";
import { GLOBAL_KEYFRAMES } from "./utils/animations";

export default function App() {
  const [targets,       setTargets]       = useState<Target[]>([]);
  const [activeTarget,  setActiveTarget]  = useState<Target | null>(null);
  const [monitorActive, setMonitorActive] = useState(false);
  const [showAdd,       setShowAdd]       = useState(false);
  const [aiModel,       setAiModel]       = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  useEffect(() => {
    loadTargets();
    api.monitor.status().then(s => setMonitorActive(s.active)).catch(() => {});
    api.info().then(i => setAiModel(i.answer_model)).catch(() => {});
  }, []);

  async function loadTargets() {
    try {
      const ts = await api.targets.list();
      setTargets(ts);
      setActiveTarget(prev => prev ?? (ts.length > 0 ? ts[0] : null));
    } catch { /* backend not ready */ }
  }

  async function handleRemove(id: string) {
    setConfirmRemove(id);
  }

  async function doRemove() {
    if (!confirmRemove) return;
    const id = confirmRemove;
    setConfirmRemove(null);
    await api.targets.remove(id);
    if (activeTarget?.id === id) setActiveTarget(null);
    await loadTargets();
  }

  async function handleAdd(name: string, type: Target["type"], config: Record<string, string>) {
    const t = await api.targets.add(name, type, config);
    const test = await api.targets.test(t.id);
    if (test.status !== "online") {
      await api.targets.remove(t.id);
      throw new Error(`Connection failed: ${test.message?.split("\n")[0] ?? "unreachable"}`);
    }
    setShowAdd(false);
    await loadTargets();
    setActiveTarget(t);
  }

  const targetName = targets.find(t => t.id === confirmRemove)?.name ?? "";

  return (
    <ThemeProvider>
    <BrowserRouter>
      <style>{GLOBAL_KEYFRAMES}</style>
      <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--c-bg-base, #0d1117)", color: "var(--c-text-primary, #e2e8f0)" }}>
        <Sidebar
          targets={targets}
          activeId={activeTarget?.id ?? null}
          onSelect={setActiveTarget}
          onRemove={handleRemove}
          onAddClick={() => setShowAdd(true)}
          monitorActive={monitorActive}
          aiModel={aiModel}
        />

        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Routes>
            <Route path="/"          element={<Home targets={targets} monitorActive={monitorActive} />} />
            <Route path="/dashboard" element={<Dashboard target={activeTarget} />} />
            <Route path="/alerts"    element={
              <Alerts
                targets={targets}
                monitorActive={monitorActive}
                onMonitorChange={setMonitorActive}
              />
            } />
            <Route path="/history" element={<History />} />
            <Route path="/chat"    element={<Chat targets={targets} activeTarget={activeTarget} />} />
            <Route path="*"        element={
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, color: "#64748b" }}>
                <div style={{ fontSize: 48, color: "#2d3148" }}>404</div>
                <div style={{ fontSize: 14 }}>Page not found</div>
              </div>
            } />
          </Routes>
        </div>

        {showAdd && (
          <AddTargetModal
            onClose={() => setShowAdd(false)}
            onAdd={handleAdd}
          />
        )}

        {/* Inline confirm dialog — replaces window.confirm() */}
        {confirmRemove && (
          <div style={{ position: "fixed", inset: 0, background: "#00000099", backdropFilter: "blur(2px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: "#1a1d27", border: "1px solid #2d3148", borderRadius: 12, padding: 24, width: 340, display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 24px 64px rgba(0,0,0,.6), 0 4px 16px rgba(0,0,0,.4)" }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Remove connection?</div>
              <div style={{ fontSize: 13, color: "#94a3b8" }}>
                Remove <strong style={{ color: "#e2e8f0" }}>{targetName}</strong>? This cannot be undone.
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={() => setConfirmRemove(null)}
                  style={{ background: "#1e2240", border: "1px solid #2d3148", color: "#94a3b8", borderRadius: 6, padding: "7px 16px", fontSize: 13, cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  onClick={doRemove}
                  style={{ background: "#b91c1c", border: "none", color: "#fff", borderRadius: 6, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        )}

        {/* P1: Cmd+K Command Palette */}
        <CommandPalette
          targets={targets}
          activeTarget={activeTarget}
          onSelectTarget={setActiveTarget}
        />
      </div>
    </BrowserRouter>
    </ThemeProvider>
  );
}
