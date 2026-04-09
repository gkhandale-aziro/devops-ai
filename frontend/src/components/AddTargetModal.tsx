import { useState, useEffect, useCallback, type ReactNode, type ChangeEvent } from "react";
import type { TargetType } from "../types";
import { api } from "../api/client";

interface Props {
  onClose: () => void;
  onAdd:   (name: string, type: TargetType, config: Record<string, string>) => Promise<void>;
}

type Step = "type" | "k8s_provider" | "details";
type K8sProvider = "local" | "eks" | "gke" | "aks";
type AuthState = "idle" | "checking" | "ok" | "fail";

const TYPE_CARDS: { type: TargetType; label: string; icon: string; color: string }[] = [
  { type: "ssh",        label: "Linux / SSH",  icon: "🖥",  color: "#56d364" },
  { type: "kubernetes", label: "Kubernetes",   icon: "⎈",   color: "#326CE5" },
  { type: "docker",     label: "Docker",       icon: "🐳",  color: "#2496ED" },
  { type: "aws",        label: "AWS",          icon: "☁",   color: "#FF9900" },
  { type: "gcp",        label: "GCP",          icon: "☁",   color: "#4285F4" },
  { type: "azure",      label: "Azure",        icon: "☁",   color: "#0078D4" },
  { type: "terraform",  label: "Terraform",    icon: "🏗",  color: "#7B42BC" },
];

const K8S_PROVIDERS: { id: K8sProvider; label: string; desc: string; icon: string; color: string }[] = [
  { id: "local", label: "Local / kubeconfig",    desc: "Docker Desktop, minikube, kind, k3s, or any existing kubeconfig", icon: "💻", color: "#326CE5" },
  { id: "eks",   label: "AWS EKS",               desc: "Amazon Elastic Kubernetes Service",                               icon: "☁",  color: "#FF9900" },
  { id: "gke",   label: "Google GKE",            desc: "Google Kubernetes Engine",                                         icon: "☁",  color: "#4285F4" },
  { id: "aks",   label: "Azure AKS",             desc: "Azure Kubernetes Service",                                         icon: "☁",  color: "#0078D4" },
];

/** Step-by-step login instructions per cloud provider */
const LOGIN_GUIDE: Record<K8sProvider, { prereq: string; steps: string[] }> = {
  local: {
    prereq: "kubectl must be installed and a kubeconfig must exist.",
    steps: [
      "Install kubectl: https://kubernetes.io/docs/tasks/tools/",
      "Verify: kubectl version --client",
      "If using minikube: minikube start",
      "If using kind: kind create cluster",
      "If using Docker Desktop: enable Kubernetes in settings",
    ],
  },
  eks: {
    prereq: "AWS CLI v2 must be installed and you must be logged in.",
    steps: [
      "Install AWS CLI: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html",
      "Configure credentials: aws configure",
      "Or use SSO: aws sso login --profile <profile>",
      "Verify: aws sts get-caller-identity",
    ],
  },
  gke: {
    prereq: "Google Cloud CLI (gcloud) must be installed and authenticated.",
    steps: [
      "Install gcloud: https://cloud.google.com/sdk/docs/install",
      "Login: gcloud auth login",
      "Set project: gcloud config set project <project-id>",
      "Verify: gcloud auth list",
    ],
  },
  aks: {
    prereq: "Azure CLI must be installed and you must be logged in.",
    steps: [
      "Install Azure CLI: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli",
      "Login: az login",
      "Set subscription (optional): az account set --subscription <id>",
      "Verify: az account show",
    ],
  },
};

export function AddTargetModal({ onClose, onAdd }: Props) {
  const [step,        setStep]        = useState<Step>("type");
  const [selType,     setSelType]     = useState<TargetType | null>(null);
  const [k8sProvider, setK8sProvider] = useState<K8sProvider>("local");
  const [name,        setName]        = useState("");
  const [config,      setConfig]      = useState<Record<string, string>>({});
  const [status,      setStatus]      = useState<{ type: "ok"|"err"|"info"; msg: string } | null>(null);
  const [busy,        setBusy]        = useState(false);

  // ── Cloud auth state ──────────────────────────────────────────────────────
  const [authState,    setAuthState]    = useState<AuthState>("idle");
  const [authIdentity, setAuthIdentity] = useState("");
  const [authError,    setAuthError]    = useState("");
  const [showGuide,    setShowGuide]    = useState(false);

  const needsCloudAuth = selType === "kubernetes" && k8sProvider !== "local";

  // Auto-check auth when entering details for a cloud K8s provider
  const checkAuth = useCallback(async (provider: K8sProvider, cfg?: Record<string, string>) => {
    setAuthState("checking");
    setAuthIdentity("");
    setAuthError("");
    try {
      const res = await api.cloud.check(provider, cfg);
      if (!res.cli_installed) {
        setAuthState("fail");
        setAuthError(res.error);
      } else if (!res.authenticated) {
        setAuthState("fail");
        setAuthError(res.error);
      } else {
        setAuthState("ok");
        setAuthIdentity(res.identity);
      }
    } catch (e) {
      setAuthState("fail");
      setAuthError(String(e));
    }
  }, []);

  // Auto-check on step transition to details for cloud providers
  useEffect(() => {
    if (step === "details" && needsCloudAuth) {
      checkAuth(k8sProvider, config);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, k8sProvider]);

  function pickType(t: TargetType) {
    setSelType(t);
    setStatus(null);
    setAuthState("idle");
    setShowGuide(false);
    if (t === "kubernetes") {
      setStep("k8s_provider");
    } else {
      setStep("details");
    }
  }

  function pickK8sProvider(p: K8sProvider) {
    setK8sProvider(p);
    setConfig(prev => ({ ...prev, provider: p }));
    setStep("details");
    setStatus(null);
    setShowGuide(false);
  }

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
        onFocus={e => (e.currentTarget.style.borderColor = "#6366f1")}
        onBlur={e  => (e.currentTarget.style.borderColor = "#2d3148")}
      />
    </div>
  );

  const area = (label: string, key: string, placeholder?: string) => (
    <div key={key} style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>{label}</div>
      <textarea
        value={config[key] ?? ""}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setConfig((prev: Record<string, string>) => ({ ...prev, [key]: e.target.value }))}
        placeholder={placeholder}
        rows={4}
        style={{ width: "100%", background: "#0d1117", border: "1px solid #2d3148", color: "#e2e8f0", borderRadius: 6, padding: "7px 10px", fontSize: 12, fontFamily: "monospace", outline: "none", resize: "vertical" }}
        onFocus={e => (e.currentTarget.style.borderColor = "#6366f1")}
        onBlur={e  => (e.currentTarget.style.borderColor = "#2d3148")}
      />
    </div>
  );

  const hint = (text: string) => (
    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12, lineHeight: 1.5, background: "#12141f", padding: "8px 10px", borderRadius: 6, border: "1px solid #1e2235" }}>
      {text}
    </div>
  );

  // ── Auth status banner ────────────────────────────────────────────────────
  const authBanner = () => {
    if (!needsCloudAuth) return null;

    const pLabel = K8S_PROVIDERS.find(p => p.id === k8sProvider)?.label ?? k8sProvider;
    const guide = LOGIN_GUIDE[k8sProvider];

    return (
      <div style={{ marginBottom: 12 }}>
        {/* Auth status indicator */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
          borderRadius: 6, fontSize: 12, lineHeight: 1.5,
          background: authState === "ok" ? "#0d2818" : authState === "fail" ? "#2a0011" : "#12141f",
          border: `1px solid ${authState === "ok" ? "#166534" : authState === "fail" ? "#7f1d1d" : "#1e2235"}`,
        }}>
          <span style={{ fontSize: 14 }}>
            {authState === "checking" ? "⏳" : authState === "ok" ? "✅" : authState === "fail" ? "❌" : "🔑"}
          </span>
          <div style={{ flex: 1 }}>
            {authState === "checking" && (
              <span style={{ color: "#94a3b8" }}>Checking {pLabel} authentication…</span>
            )}
            {authState === "ok" && (
              <span style={{ color: "#4ade80" }}>
                Logged in — {authIdentity.split("\n")[0].slice(0, 80)}
              </span>
            )}
            {authState === "fail" && (
              <div>
                <span style={{ color: "#fb7185" }}>Not authenticated</span>
                {authError && (
                  <div style={{ color: "#94a3b8", marginTop: 4, fontSize: 11 }}>{authError}</div>
                )}
              </div>
            )}
            {authState === "idle" && (
              <span style={{ color: "#94a3b8" }}>Cloud login required for {pLabel}</span>
            )}
          </div>
          {authState !== "checking" && (
            <button
              onClick={() => checkAuth(k8sProvider, config)}
              style={{
                background: "none", border: "1px solid #2d3148", color: "#94a3b8",
                borderRadius: 4, padding: "3px 8px", fontSize: 11, cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {authState === "ok" ? "Re-check" : "Verify Login"}
            </button>
          )}
        </div>

        {/* Toggle login guide */}
        {authState === "fail" && (
          <button
            onClick={() => setShowGuide(prev => !prev)}
            style={{
              background: "none", border: "none", color: "#7c8cf8", fontSize: 11,
              cursor: "pointer", padding: "6px 0 2px", textDecoration: "underline",
            }}
          >
            {showGuide ? "Hide setup instructions" : "Show how to login ↓"}
          </button>
        )}

        {/* Login guide steps */}
        {showGuide && (
          <div style={{
            marginTop: 6, padding: "10px 12px", borderRadius: 6, fontSize: 11,
            background: "#0d1117", border: "1px solid #1e2235", lineHeight: 1.7,
          }}>
            <div style={{ color: "#e2e8f0", fontWeight: 600, marginBottom: 6 }}>
              Prerequisites — {guide.prereq}
            </div>
            <ol style={{ margin: 0, paddingLeft: 18, color: "#94a3b8" }}>
              {guide.steps.map((s, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  {s.startsWith("http") ? (
                    <code style={{ color: "#7c8cf8", fontSize: 11 }}>{s}</code>
                  ) : s.includes(": ") ? (
                    <>
                      {s.split(": ")[0]}:{" "}
                      <code style={{ color: "#fbbf24", background: "#1a1a2e", padding: "1px 4px", borderRadius: 3, fontSize: 11 }}>
                        {s.split(": ").slice(1).join(": ")}
                      </code>
                    </>
                  ) : s}
                </li>
              ))}
            </ol>
            <div style={{ color: "#64748b", marginTop: 8, fontStyle: "italic" }}>
              After logging in, click "Verify Login" above to confirm.
            </div>
          </div>
        )}
      </div>
    );
  };

  const k8sFields: Record<K8sProvider, ReactNode> = {
    local: <>
      {hint("For Docker Desktop, minikube, kind, k3s, or any cluster with an existing kubeconfig. Paste kubeconfig content OR provide a path inside the container.")}
      {authBanner()}
      {field("Context", "context", "e.g. minikube, docker-desktop (blank = current)")}
      {area("Kubeconfig content", "kubeconfig_data", "Paste kubeconfig YAML here (optional)")}
      {field("Kubeconfig path", "kubeconfig", "only if file exists inside container (blank = default)")}
    </>,
    eks: <>
      {authBanner()}
      {field("Cluster name *", "cluster", "my-eks-cluster")}
      {field("AWS Region", "region", "us-east-1")}
      {field("AWS Profile", "profile", "default (blank = default)")}
      {field("Context (override)", "context", "auto-generated if blank")}
      {field("Kubeconfig path", "kubeconfig", "~/.kube/config (blank = default)")}
    </>,
    gke: <>
      {authBanner()}
      {field("Cluster name *", "cluster", "my-gke-cluster")}
      {field("Project *", "project", "my-gcp-project")}
      {field("Zone / Region", "zone", "us-central1-a or us-central1")}
      {field("Context (override)", "context", "auto-generated if blank")}
      {field("Kubeconfig path", "kubeconfig", "~/.kube/config (blank = default)")}
    </>,
    aks: <>
      {authBanner()}
      {field("Cluster name *", "cluster", "my-aks-cluster")}
      {field("Resource group *", "resource_group", "my-resource-group")}
      {field("Subscription", "subscription", "subscription-id (blank = default)")}
      {field("Context (override)", "context", "auto-generated if blank")}
      {field("Kubeconfig path", "kubeconfig", "~/.kube/config (blank = default)")}
    </>,
  };

  const fields: Partial<Record<TargetType, ReactNode>> = {
    ssh: <>
      {field("Host", "host", "192.168.1.10 or hostname")}
      {field("Port", "port", "22")}
      {field("Username", "user", "ubuntu")}
      {field("Password", "password", "optional", "password")}
      {field("Key path", "key_path", "~/.ssh/id_rsa (optional)")}
      {field("Key passphrase", "key_passphrase", "passphrase for encrypted key (optional)", "password")}
    </>,
    kubernetes: k8sFields[k8sProvider],
    docker: <>
      {hint("For local Docker, leave all fields blank. For a remote daemon, provide the host and optionally TLS settings.")}
      {field("Docker host", "host", "tcp://remote-host:2376 (blank = local)")}
      {field("TLS verify", "tls_verify", "1 to enable TLS verification (blank = off)")}
      {field("TLS cert path", "cert_path", "/etc/docker/certs.d/host (optional)")}
      {field("API version", "api_version", "1.41 (blank = auto)")}
    </>,
    aws: <>
      {hint("Use a named profile, or provide access keys directly. Keys take precedence over profile.")}
      {field("Profile", "profile", "default")}
      {field("Region", "region", "us-east-1")}
      {field("Access Key ID", "access_key_id", "AKIA... (optional if using profile)")}
      {field("Secret Access Key", "secret_access_key", "optional", "password")}
      {field("Session Token", "session_token", "for temporary credentials (optional)", "password")}
      {field("Endpoint URL", "endpoint_url", "http://localhost:4566 (LocalStack, optional)")}
    </>,
    gcp: <>
      {field("Project", "project", "my-project")}
      {field("Region", "region", "us-central1 (optional)")}
      {field("Zone", "zone", "us-central1-a (optional, overrides region)")}
      {area("Service Account Key JSON", "service_account_key", "Paste SA key JSON content (optional)")}
      {field("SA Key File path", "service_account_key_file", "only if file exists inside container (optional)")}
    </>,
    azure: <>
      {field("Subscription", "subscription", "subscription-id or name")}
      {field("Resource Group", "resource_group", "my-resource-group (optional)")}
      {field("Tenant ID", "tenant", "tenant-id for multi-tenant envs (optional)")}
    </>,
    terraform: <>
      {hint("Workspace is the directory containing your .tf files. Terraform's -chdir flag will be injected automatically.")}
      {field("Workspace directory", "workspace", "/path/to/terraform/project")}
    </>,
  };

  const overlay: React.CSSProperties = { position: "fixed", inset: 0, background: "#00000099", backdropFilter: "blur(2px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" };
  const box: React.CSSProperties     = { background: "#1a1d27", border: "1px solid #2d3148", borderRadius: 12, padding: 24, width: 440, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,.6), 0 4px 16px rgba(0,0,0,.4)" };

  const providerLabel = K8S_PROVIDERS.find(p => p.id === k8sProvider)?.label ?? "Kubernetes";

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={box}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <strong style={{ fontSize: 14 }}>
            {step === "type" ? "Add Connection"
              : step === "k8s_provider" ? "Kubernetes Provider"
              : selType === "kubernetes" ? `Connect — ${providerLabel}` : `Connect to ${selType}`}
          </strong>
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

        {step === "k8s_provider" && (
          <>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>
              How is your Kubernetes cluster hosted?
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {K8S_PROVIDERS.map(p => (
                <div
                  key={p.id}
                  onClick={() => pickK8sProvider(p.id)}
                  style={{ background: "#12141f", border: "1px solid #2d3148", borderRadius: 8, padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, transition: "border-color .15s" }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = p.color)}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "#2d3148")}
                >
                  <span style={{ fontSize: 20 }}>{p.icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{p.label}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{p.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setStep("type")} style={{ marginTop: 12, width: "100%", background: "#1a1d27", border: "1px solid #2d3148", color: "#94a3b8", borderRadius: 6, padding: 8, fontSize: 13, cursor: "pointer" }}>
              ← Back
            </button>
          </>
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
                onFocus={e => (e.currentTarget.style.borderColor = "#6366f1")}
                onBlur={e  => (e.currentTarget.style.borderColor = "#2d3148")}
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
              <button onClick={() => setStep(selType === "kubernetes" ? "k8s_provider" : "type")} style={{ flex: 1, background: "#1a1d27", border: "1px solid #2d3148", color: "#94a3b8", borderRadius: 6, padding: 8, fontSize: 13, cursor: "pointer" }}>
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
