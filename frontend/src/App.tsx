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
import { ConfirmDialog } from "./components/confirm-dialog";
import { GLOBAL_KEYFRAMES } from "./utils/animations";
import { Toaster } from "sonner";
import { toast } from "./utils/toast";
import { ErrorBoundary } from "./components/ErrorBoundary";

export default function App() {
  const [targets,       setTargets]       = useState<Target[]>([]);
  const [activeTarget,  setActiveTarget]  = useState<Target | null>(null);
  const [monitorActive, setMonitorActive] = useState(false);
  const [showAdd,       setShowAdd]       = useState(false);
  const [aiModel,       setAiModel]       = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  useEffect(() => {
    loadTargets();
    api.monitor.status().then(s => setMonitorActive(s.active))
      .catch(e => console.warn("[App] monitor.status failed:", (e as Error)?.message));
    api.info().then(i => setAiModel(i.answer_model))
      .catch(e => console.warn("[App] info failed:", (e as Error)?.message));
  }, []);

  async function loadTargets() {
    try {
      const ts = await api.targets.list();
      setTargets(ts);
      setActiveTarget(prev => prev ?? (ts.length > 0 ? ts[0] : null));
    } catch (e) {
      console.warn("[App] targets.list failed — backend may not be ready:", (e as Error)?.message);
    }
  }

  async function handleRemove(id: string) {
    setConfirmRemove(id);
  }

  async function doRemove() {
    if (!confirmRemove) return;
    const id = confirmRemove;
    const name = targets.find(t => t.id === id)?.name ?? "target";
    setConfirmRemove(null);
    await api.targets.remove(id);
    if (activeTarget?.id === id) setActiveTarget(null);
    await loadTargets();
    toast.info(`Removed ${name}`);
  }

  async function handleAdd(name: string, type: Target["type"], config: Record<string, string>) {
    const t = await api.targets.add(name, type, config);
    const test = await api.targets.test(t.id);
    if (test.status !== "online") {
      await api.targets.remove(t.id);
      toast.error(`Connection failed: ${test.message?.split("\n")[0] ?? "unreachable"}`);
      throw new Error(`Connection failed: ${test.message?.split("\n")[0] ?? "unreachable"}`);
    }
    setShowAdd(false);
    await loadTargets();
    setActiveTarget(t);
    toast.success(`Connected to ${name}`);
  }

  const targetName = targets.find(t => t.id === confirmRemove)?.name ?? "";

  return (
    <ThemeProvider>
    <BrowserRouter>
      <style>{GLOBAL_KEYFRAMES}</style>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: "var(--c-bg-surface)",
            color: "var(--c-text-primary)",
            border: "1px solid var(--c-border)",
            fontSize: 13,
          },
        }}
      />
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
            <Route path="/"          element={<ErrorBoundary><Home targets={targets} monitorActive={monitorActive} /></ErrorBoundary>} />
            <Route path="/dashboard" element={<ErrorBoundary><Dashboard target={activeTarget} /></ErrorBoundary>} />
            <Route path="/alerts"    element={
              <ErrorBoundary><Alerts
                targets={targets}
                monitorActive={monitorActive}
                onMonitorChange={setMonitorActive}
              /></ErrorBoundary>
            } />
            <Route path="/history" element={<ErrorBoundary><History /></ErrorBoundary>} />
            <Route path="/chat"    element={<ErrorBoundary><Chat targets={targets} activeTarget={activeTarget} /></ErrorBoundary>} />
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

        <ConfirmDialog
          open={!!confirmRemove}
          onOpenChange={(open) => { if (!open) setConfirmRemove(null); }}
          title="Remove connection?"
          description={`Remove ${targetName}? This cannot be undone.`}
          confirmLabel="Remove"
          cancelLabel="Cancel"
          onConfirm={doRemove}
          variant="destructive"
        />

        {/* Cmd+K Command Palette */}
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
