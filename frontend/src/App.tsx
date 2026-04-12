import { useState, useEffect, useCallback } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import type { Target } from "./types";
import { api, type ModelHealthStatus } from "./api/client";
import { Sidebar }    from "./components/Sidebar";
import { Home }       from "./pages/Home";
import { Dashboard }  from "./pages/Dashboard";
import { Alerts }     from "./pages/Alerts";
import { History }    from "./pages/History";
import { Chat }       from "./pages/Chat";
import { Settings }   from "./pages/Settings";
import { AddTargetModal } from "./components/AddTargetModal";
import { CommandPalette, SearchBar } from "./components/CommandPalette";
import { KeyboardHelp } from "./components/KeyboardHelp";
import { GlobalResourceDetail } from "./components/GlobalResourceDetail";
import { ThemeProvider }  from "./components/ThemeContext";
import { ConfirmDialog } from "./components/confirm-dialog";
import { GLOBAL_KEYFRAMES } from "./utils/animations";
import { Toaster } from "sonner";
import { toast } from "./utils/toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ModelStatusBanner } from "./components/ModelStatusBanner";
import { AlertBanner } from "./components/AlertBanner";
import { OnboardingTour } from "./components/OnboardingTour";

export default function App() {
  const [targets,       setTargets]       = useState<Target[]>([]);
  const [activeTarget,  setActiveTarget]  = useState<Target | null>(null);
  const [monitorActive, setMonitorActive] = useState(false);
  const [showAdd,       setShowAdd]       = useState(false);
  const [aiModel,       setAiModel]       = useState("");
  const [health,        setHealth]        = useState<ModelHealthStatus | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [editTarget,    setEditTarget]    = useState<Target | null>(null);

  const pollHealth = useCallback(() => {
    api.modelHealth().then(h => {
      setHealth(h);
      // Show the model actually being used right now
      if (h.status === "fallback" && h.fallback_model) {
        setAiModel(h.fallback_model.split(" / ")[0]); // show tool model
      } else if (h.primary_answer) {
        setAiModel(h.primary_answer);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadTargets();
    api.monitor.status().then(s => setMonitorActive(s.active))
      .catch(e => console.warn("[App] monitor.status failed:", (e as Error)?.message));
    // Initial load + poll health every 30s
    api.info().then(i => setAiModel(i.answer_model))
      .catch(e => console.warn("[App] info failed:", (e as Error)?.message));
    pollHealth();
    const t = setInterval(pollHealth, 30_000);
    return () => clearInterval(t);
  }, [pollHealth]);

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

  async function handleUpdate(id: string, name: string, config: Record<string, string>) {
    await api.targets.update(id, name, config);
    const test = await api.targets.test(id);
    if (test.status !== "online") {
      toast.error(`Connection failed: ${test.message?.split("\n")[0] ?? "unreachable"}`);
      throw new Error(`Connection failed: ${test.message?.split("\n")[0] ?? "unreachable"}`);
    }
    setEditTarget(null);
    await loadTargets();
    toast.success(`Updated ${name}`);
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
      <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--c-bg-base)", color: "var(--c-text-primary)" }}>
        <Sidebar
          targets={targets}
          activeId={activeTarget?.id ?? null}
          onSelect={setActiveTarget}
          onRemove={handleRemove}
          onEdit={setEditTarget}
          onAddClick={() => setShowAdd(true)}
          monitorActive={monitorActive}
          aiModel={aiModel}
          onModelChange={(m) => { setAiModel(m); pollHealth(); }}
          modelStatus={health?.status ?? "healthy"}
        />

        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <ModelStatusBanner onModelChange={() => { window.location.href = "/settings"; }} />
          <AlertBanner monitorActive={monitorActive} />

          {/* Top bar — search */}
          <header style={{
            padding: "8px 20px", borderBottom: "1px solid var(--c-border)",
            display: "flex", alignItems: "center", justifyContent: "flex-end",
            flexShrink: 0, background: "var(--c-bg-raised)",
          }}>
            <SearchBar />
          </header>

          <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
            <Route path="/settings" element={<ErrorBoundary><Settings targetCount={targets.length} /></ErrorBoundary>} />
            <Route path="*"        element={
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, color: "var(--c-text-muted)" }}>
                <div style={{ fontSize: 48, color: "var(--c-border)" }}>404</div>
                <div style={{ fontSize: 14 }}>Page not found</div>
              </div>
            } />
          </Routes>
          </main>
        </div>

        {showAdd && (
          <AddTargetModal
            onClose={() => setShowAdd(false)}
            onAdd={handleAdd}
          />
        )}

        {editTarget && (
          <AddTargetModal
            onClose={() => setEditTarget(null)}
            onAdd={handleAdd}
            editTarget={editTarget}
            onUpdate={handleUpdate}
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

        {/* ? Keyboard shortcut cheat sheet */}
        <KeyboardHelp />

        {/* Global resource-detail modal (driven by resourceDetailStore) */}
        <GlobalResourceDetail />

        {/* First-run guided tour — auto-runs once, replayable from Settings */}
        <OnboardingTour />
      </div>
    </BrowserRouter>
    </ThemeProvider>
  );
}
