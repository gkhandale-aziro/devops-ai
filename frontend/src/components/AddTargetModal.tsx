import { useState, type ReactNode, type ChangeEvent } from "react";
import type { TargetType } from "../types";

interface Props {
  onClose: () => void;
  onAdd:   (name: string, type: TargetType, config: Record<string, string>) => Promise<void>;
}

type Step = "type" | "details";

const TYPE_CARDS: { type: TargetType; label: string; icon: string; color: string }[] = [
  { type: "ssh",        label: "Linux / SSH",  icon: "🖥",  color: "#56d364" },
  { type: "kubernetes", label: "Kubernetes",   icon: "⎈",   color: "#326CE5" },
  { type: "docker",     label: "Docker",       icon: "🐳",  color: "#2496ED" },
  { type: "aws",        label: "AWS",          icon: "☁",   color: "#FF9900" },
  { type: "gcp",        label: "GCP",          icon: "☁",   color: "#4285F4" },
  { type: "azure",      label: "Azure",        icon: "☁",   color: "#0078D4" },
  { type: "terraform",  label: "Terraform",    icon: "🏗",  color: "#7B42BC" },
];

export function AddTargetModal({ onClose, onAdd }: Props) {
  const [step,     setStep]     = useState<Step>("type");
  const [selType,  setSelType]  = useState<TargetType | null>(null);
  const [name,     setName]     = useState("");
  const [config,   setConfig]   = useState<Record<string, string>>({});
  const [status,   setStatus]   = useState<{ type: "ok"|"err"|"info"; msg: string } | null>(null);
  const [busy,     setBusy]     = useState(false);

  function pickType(t: TargetType) { setSelType(t); setStep("details"); setStatus(null); }

  async function submit() {
    if (!selType || !name.trim()) { setStatus({ type: "err", msg: "Name is required" }); return; }
    setBusy(true);
    setStatus({ type: "info", msg: "Testing connection…" });
    try {
      await onAdd(name.trim(), selType, config);
    } catch (e) {
      setStatus({ type: "err", msg: String(e) });
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, key: string, placeholder?: string, type = "text") => (
    <div key={key} style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>{label}</div>
      <input
        type={type}
        value={config[key] ?? ""}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setConfig((prev: Record<string, string>) => ({ ...prev, [key]: e.target.value }))}
        placeholder={placeholder}
        style={{ width: "100%", background: "#0d1117", border: "1px solid #2d3148", color: "#e2e8f0", borderRadius: 6, padding: "7px 10px", fontSize: 13, outline: "none" }}
      />
    </div>
  );

  const fields: Partial<Record<TargetType, ReactNode>> = {
    ssh: <>{field("Host", "host", "user@host or IP")} {field("Port", "port", "22")} {field("Username", "user", "ubuntu")} {field("Password", "password", "optional", "password")} {field("Key path", "key_path", "~/.ssh/id_rsa (optional)")}</>,
    kubernetes: <>{field("Context", "context", "default (leave blank for current)")} {field("Kubeconfig", "kubeconfig", "~/.kube/config (optional)")}</>,
    docker: <>{field("Docker host", "host", "unix:///var/run/docker.sock")}</>,
    aws: <>{field("Profile", "profile", "default")} {field("Region", "region", "us-east-1")}</>,
    gcp: <>{field("Project", "project", "my-project")}</>,
    azure: <>{field("Subscription", "subscription", "subscription-id or name")}</>,
    terraform: <>{field("Workspace", "workspace", "default")}</>,
  };

  const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "#00000088", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" };
  const box: React.CSSProperties     = { background: "#1a1d27", border: "1px solid #2d3148", borderRadius: 10, padding: 24, width: 400 };

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={box}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <strong style={{ fontSize: 14 }}>{step === "type" ? "Add Connection" : `Connect to ${selType}`}</strong>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", color: "#64748b", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>

        {step === "type" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {TYPE_CARDS.map(tc => (
              <div
                key={tc.type}
                onClick={() => pickType(tc.type)}
                style={{ background: "#12141f", border: "1px solid #2d3148", borderRadius: 8, padding: "14px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, transition: "border-color .15s" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = tc.color)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "#2d3148")}
              >
                <span style={{ fontSize: 22 }}>{tc.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{tc.label}</span>
              </div>
            ))}
          </div>
        )}

        {step === "details" && selType && (
          <>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>Name</div>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="prod-k8s"
                autoFocus
                style={{ width: "100%", background: "#0d1117", border: "1px solid #2d3148", color: "#e2e8f0", borderRadius: 6, padding: "7px 10px", fontSize: 13, outline: "none" }}
              />
            </div>
            {fields[selType]}

            {status && (
              <div style={{ padding: "8px 10px", borderRadius: 6, fontSize: 12, marginBottom: 10,
                background: status.type === "ok" ? "#1a3a2a" : status.type === "err" ? "#3a1a1a" : "#1f2d3d",
                color:      status.type === "ok" ? "#22c55e" : status.type === "err" ? "#ef4444" : "#7c8cf8",
              }}>
                {status.msg}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button onClick={() => setStep("type")} style={{ flex: 1, background: "#1a1d27", border: "1px solid #2d3148", color: "#94a3b8", borderRadius: 6, padding: 8, fontSize: 13, cursor: "pointer" }}>
                ← Back
              </button>
              <button onClick={submit} disabled={busy} style={{ flex: 2, background: busy ? "#374151" : "#4f46e5", border: "none", color: "#fff", borderRadius: 6, padding: 8, fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer" }}>
                {busy ? "Connecting…" : "Connect"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
