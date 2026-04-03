import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import type { Target } from "./types";
import { api }        from "./api/client";
import { Sidebar }    from "./components/Sidebar";
import { Dashboard }  from "./pages/Dashboard";
import { Alerts }     from "./pages/Alerts";
import { History }    from "./pages/History";
import { AddTargetModal } from "./components/AddTargetModal";

export default function App() {
  const [targets,       setTargets]       = useState<Target[]>([]);
  const [activeTarget,  setActiveTarget]  = useState<Target | null>(null);
  const [monitorActive, setMonitorActive] = useState(false);
  const [showAdd,       setShowAdd]       = useState(false);

  useEffect(() => {
    loadTargets();
    // check if monitor was already running (page refresh)
    api.monitor.status().then(s => setMonitorActive(s.active)).catch(() => {});
  }, []);

  async function loadTargets() {
    try {
      const ts = await api.targets.list();
      setTargets(ts);
      if (!activeTarget && ts.length > 0) setActiveTarget(ts[0]);
    } catch { /* backend not ready */ }
  }

  async function handleRemove(id: string) {
    if (!confirm("Remove this connection?")) return;
    await api.targets.remove(id);
    if (activeTarget?.id === id) setActiveTarget(null);
    loadTargets();
  }

  async function handleAdd(name: string, type: Target["type"], config: Record<string, string>) {
    const t = await api.targets.add(name, type, config);
    // Test connection — remove target and surface error if it fails
    const test = await api.targets.test(t.id);
    if (test.status !== "online") {
      await api.targets.remove(t.id);
      throw new Error(`Connection failed: ${test.message?.split("\n")[0] ?? "unreachable"}`);
    }
    setShowAdd(false);
    await loadTargets();
    setActiveTarget(t);
  }

  return (
    <BrowserRouter>
      <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#0d1117", color: "#e2e8f0" }}>
        <Sidebar
          targets={targets}
          activeId={activeTarget?.id ?? null}
          onSelect={setActiveTarget}
          onRemove={handleRemove}
          onAddClick={() => setShowAdd(true)}
          monitorActive={monitorActive}
        />

        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Routes>
            <Route path="/"        element={<Dashboard target={activeTarget} />} />
            <Route path="/alerts"  element={
              <Alerts
                targets={targets}
                monitorActive={monitorActive}
                onMonitorChange={setMonitorActive}
              />
            } />
            <Route path="/history" element={<History />} />
          </Routes>
        </div>

        {showAdd && (
          <AddTargetModal
            onClose={() => setShowAdd(false)}
            onAdd={handleAdd}
          />
        )}
      </div>
    </BrowserRouter>
  );
}
