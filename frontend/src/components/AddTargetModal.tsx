import { useState, useEffect, useCallback, useRef, useId, type ReactNode, type ChangeEvent } from "react";
import { X, Loader2, CheckCircle2, XCircle, KeyRound, Cloud, CloudCog, MonitorCloud, Laptop, ArrowLeft } from "lucide-react";
import type { TargetType } from "../types";
import { TARGET_META } from "../utils/targetIcons";
import { api } from "../api/client";

interface Props {
  onClose: () => void;
  onAdd:   (name: string, type: TargetType, config: Record<string, string>) => Promise<void>;
  /** When set, the modal opens in edit mode — pre-filled, type step skipped. */
  editTarget?: { id: string; name: string; type: TargetType; config: Record<string, string> };
  onUpdate?: (id: string, name: string, config: Record<string, string>) => Promise<void>;
}

type Step = "type" | "k8s_provider" | "details";
type K8sProvider = "local" | "eks" | "gke" | "aks";
type AuthState = "idle" | "checking" | "ok" | "fail";

const TYPE_CARDS: { type: TargetType; label: string; color: string }[] = [
  { type: "ssh",        label: "Linux / SSH",  color: "#22c55e" },
  { type: "kubernetes", label: "Kubernetes",   color: "#326CE5" },
  { type: "docker",     label: "Docker",       color: "#2496ED" },
  { type: "aws",        label: "AWS",          color: "#FF9900" },
  { type: "gcp",        label: "GCP",          color: "#4285F4" },
  { type: "azure",      label: "Azure",        color: "#0078D4" },
  { type: "terraform",  label: "Terraform",    color: "#7B42BC" },
];

const K8S_PROVIDERS: { id: K8sProvider; label: string; desc: string; icon: ReactNode; color: string }[] = [
  { id: "local", label: "Local / kubeconfig",    desc: "Docker Desktop, minikube, kind, k3s, or any existing kubeconfig", icon: <Laptop size={20} />,       color: "#326CE5" },
  { id: "eks",   label: "AWS EKS",               desc: "Amazon Elastic Kubernetes Service",                               icon: <Cloud size={20} />,        color: "#FF9900" },
  { id: "gke",   label: "Google GKE",            desc: "Google Kubernetes Engine",                                         icon: <CloudCog size={20} />,     color: "#4285F4" },
  { id: "aks",   label: "Azure AKS",             desc: "Azure Kubernetes Service",                                         icon: <MonitorCloud size={20} />, color: "#0078D4" },
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

export function AddTargetModal({ onClose, onAdd, editTarget, onUpdate }: Props) {
  const isEdit = !!editTarget;
  const [step,        setStep]        = useState<Step>(isEdit ? "details" : "type");
  const [selType,     setSelType]     = useState<TargetType | null>(isEdit ? editTarget.type : null);
  const [k8sProvider, setK8sProvider] = useState<K8sProvider>(
    isEdit && editTarget.type === "kubernetes"
      ? (editTarget.config.provider as K8sProvider) ?? "local"
      : "local"
  );
  const [name,        setName]        = useState(isEdit ? editTarget.name : "");
  const [config,      setConfig]      = useState<Record<string, string>>(isEdit ? { ...editTarget.config } : {});
  const [status,      setStatus]      = useState<{ type: "ok"|"err"|"info"; msg: string } | null>(null);
  const [busy,        setBusy]        = useState(false);

  // a11y: unique id prefix for <label htmlFor> associations
  const fieldIdPrefix = useId();
  // a11y: focus trap + restore focus on close
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // On mount: remember the element that had focus, move focus into the dialog.
  // On unmount: restore focus to that element so keyboard users don't lose context.
  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    // Move focus to the dialog itself so the initial Tab stays inside.
    dialogRef.current?.focus();
    return () => { previouslyFocusedRef.current?.focus?.(); };
  }, []);

  // Escape closes; Tab stays trapped inside the dialog.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last  = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

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
    setStatus({ type: "info", msg: isEdit ? "Updating…" : "Testing connection…" });
    try {
      if (isEdit && onUpdate) {
        await onUpdate(editTarget.id, name.trim(), config);
      } else {
        await onAdd(name.trim(), selType, config);
      }
    } catch (e) {
      setStatus({ type: "err", msg: String(e) });
    } finally {
      setBusy(false);
    }
  }

  const fieldId = (key: string) => `${fieldIdPrefix}-${key}`;

  const field = (label: string, key: string, placeholder?: string, type = "text") => {
    const id = fieldId(key);
    return (
      <div key={key} style={{ marginBottom: 10 }}>
        <label htmlFor={id} style={{ display: "block", fontSize: 12, color: "var(--c-text-secondary)", marginBottom: 4 }}>{label}</label>
        <input
          id={id}
          type={type}
          value={config[key] ?? ""}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setConfig((prev: Record<string, string>) => ({ ...prev, [key]: e.target.value }))}
          placeholder={placeholder}
          style={{ width: "100%", background: "var(--c-bg-raised)", border: "1px solid var(--c-border)", color: "var(--c-text-primary)", borderRadius: 6, padding: "7px 10px", fontSize: 13, outline: "none" }}
          onFocus={e => (e.currentTarget.style.borderColor = "var(--c-accent)")}
          onBlur={e  => (e.currentTarget.style.borderColor = "var(--c-border)")}
        />
      </div>
    );
  };

  const area = (label: string, key: string, placeholder?: string) => {
    const id = fieldId(key);
    return (
      <div key={key} style={{ marginBottom: 10 }}>
        <label htmlFor={id} style={{ display: "block", fontSize: 12, color: "var(--c-text-secondary)", marginBottom: 4 }}>{label}</label>
        <textarea
          id={id}
          value={config[key] ?? ""}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setConfig((prev: Record<string, string>) => ({ ...prev, [key]: e.target.value }))}
          placeholder={placeholder}
          rows={4}
          style={{ width: "100%", background: "var(--c-bg-raised)", border: "1px solid var(--c-border)", color: "var(--c-text-primary)", borderRadius: 6, padding: "7px 10px", fontSize: 12, fontFamily: "monospace", outline: "none", resize: "vertical" }}
          onFocus={e => (e.currentTarget.style.borderColor = "var(--c-accent)")}
          onBlur={e  => (e.currentTarget.style.borderColor = "var(--c-border)")}
        />
      </div>
    );
  };

  const hint = (text: string) => (
    <div style={{ fontSize: 11, color: "var(--c-text-muted)", marginBottom: 12, lineHeight: 1.5, background: "var(--c-bg-base)", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--c-border)" }}>
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
          background: authState === "ok" ? "#0d2818" : authState === "fail" ? "#2a0011" : "var(--c-bg-base)",
          border: `1px solid ${authState === "ok" ? "#166534" : authState === "fail" ? "#7f1d1d" : "var(--c-border)"}`,
        }}>
          <span style={{ display: "flex", alignItems: "center" }}>
            {authState === "checking" ? <Loader2 size={14} className="animate-spin" style={{ color: "var(--c-text-secondary)" }} />
              : authState === "ok" ? <CheckCircle2 size={14} style={{ color: "#4ade80" }} />
              : authState === "fail" ? <XCircle size={14} style={{ color: "#fb7185" }} />
              : <KeyRound size={14} style={{ color: "var(--c-text-secondary)" }} />}
          </span>
          <div style={{ flex: 1 }}>
            {authState === "checking" && (
              <span style={{ color: "var(--c-text-secondary)" }}>Checking {pLabel} authentication…</span>
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
                  <div style={{ color: "var(--c-text-secondary)", marginTop: 4, fontSize: 11 }}>{authError}</div>
                )}
              </div>
            )}
            {authState === "idle" && (
              <span style={{ color: "var(--c-text-secondary)" }}>Cloud login required for {pLabel}</span>
            )}
          </div>
          {authState !== "checking" && (
            <button
              onClick={() => checkAuth(k8sProvider, config)}
              style={{
                background: "none", border: "1px solid var(--c-border)", color: "var(--c-text-secondary)",
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
              background: "none", border: "none", color: "var(--c-accent-hover)", fontSize: 11,
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
            background: "var(--c-bg-raised)", border: "1px solid var(--c-border)", lineHeight: 1.7,
          }}>
            <div style={{ color: "var(--c-text-primary)", fontWeight: 600, marginBottom: 6 }}>
              Prerequisites — {guide.prereq}
            </div>
            <ol style={{ margin: 0, paddingLeft: 18, color: "var(--c-text-secondary)" }}>
              {guide.steps.map((s, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  {s.startsWith("http") ? (
                    <code style={{ color: "var(--c-accent-hover)", fontSize: 11 }}>{s}</code>
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
            <div style={{ color: "var(--c-text-muted)", marginTop: 8, fontStyle: "italic" }}>
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
      {field("Access Key ID", "access_key_id", "AKIA… (optional if using profile)")}
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
  const box: React.CSSProperties     = { background: "var(--c-bg-card)", border: "1px solid var(--c-border)", borderRadius: 12, padding: 24, width: 440, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 24px 64px rgba(0,0,0,.6), 0 4px 16px rgba(0,0,0,.4)" };

  const providerLabel = K8S_PROVIDERS.find(p => p.id === k8sProvider)?.label ?? "Kubernetes";

  const titleId = `${fieldIdPrefix}-title`;

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ ...box, outline: "none" }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <strong id={titleId} style={{ fontSize: 14, color: "var(--c-text-primary)" }}>
            {isEdit
              ? `Edit — ${name || selType}`
              : step === "type" ? "Add Connection"
              : step === "k8s_provider" ? "Kubernetes Provider"
              : selType === "kubernetes" ? `Connect — ${providerLabel}` : `Connect to ${selType}`}
          </strong>
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--c-text-muted)", cursor: "pointer", display: "flex", alignItems: "center" }}><X size={18} /></button>
        </div>

        {step === "type" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {TYPE_CARDS.map(tc => (
              <button
                key={tc.type}
                type="button"
                onClick={() => pickType(tc.type)}
                style={{ background: "var(--c-bg-base)", border: "1px solid var(--c-border)", borderRadius: 8, padding: "14px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, transition: "border-color .15s", textAlign: "left", font: "inherit", color: "inherit" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = tc.color)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--c-border)")}
              >
                <span style={{ color: tc.color, display: "flex", alignItems: "center" }} aria-hidden="true">
                  {(() => { const Icon = TARGET_META[tc.type].icon; return <Icon size={20} />; })()}
                </span>
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--c-text-primary)" }}>{tc.label}</span>
              </button>
            ))}
          </div>
        )}

        {step === "k8s_provider" && (
          <>
            <div style={{ fontSize: 12, color: "var(--c-text-secondary)", marginBottom: 12 }}>
              How is your Kubernetes cluster hosted?
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {K8S_PROVIDERS.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickK8sProvider(p.id)}
                  style={{ background: "var(--c-bg-base)", border: "1px solid var(--c-border)", borderRadius: 8, padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, transition: "border-color .15s", textAlign: "left", font: "inherit", color: "inherit", width: "100%" }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = p.color)}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--c-border)")}
                >
                  <span style={{ color: p.color, display: "flex", alignItems: "center" }} aria-hidden="true">{p.icon}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--c-text-primary)" }}>{p.label}</div>
                    <div style={{ fontSize: 11, color: "var(--c-text-muted)", marginTop: 2 }}>{p.desc}</div>
                  </div>
                </button>
              ))}
            </div>
            <button onClick={() => setStep("type")} style={{ marginTop: 12, width: "100%", background: "var(--c-bg-card)", border: "1px solid var(--c-border)", color: "var(--c-text-secondary)", borderRadius: 6, padding: 8, fontSize: 13, cursor: "pointer" }}>
              <ArrowLeft size={12} style={{ marginRight: 4 }} /> Back
            </button>
          </>
        )}

        {step === "details" && selType && (
          <>
            <div style={{ marginBottom: 10 }}>
              <label htmlFor={fieldId("__name")} style={{ display: "block", fontSize: 12, color: "var(--c-text-secondary)", marginBottom: 4 }}>Name</label>
              <input
                id={fieldId("__name")}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="prod-k8s"
                autoFocus
                style={{ width: "100%", background: "var(--c-bg-raised)", border: "1px solid var(--c-border)", color: "var(--c-text-primary)", borderRadius: 6, padding: "7px 10px", fontSize: 13, outline: "none" }}
                onFocus={e => (e.currentTarget.style.borderColor = "var(--c-accent)")}
                onBlur={e  => (e.currentTarget.style.borderColor = "var(--c-border)")}
              />
            </div>
            {fields[selType]}

            {status && (
              <div style={{ padding: "8px 10px", borderRadius: 6, fontSize: 12, marginBottom: 10,
                background: status.type === "ok" ? "#1a3a2a" : status.type === "err" ? "#3a1a1a" : "#1f2d3d",
                color:      status.type === "ok" ? "#22c55e" : status.type === "err" ? "#ef4444" : "var(--c-accent-hover)",
              }}>
                {status.msg}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              {!isEdit && (
                <button onClick={() => setStep(selType === "kubernetes" ? "k8s_provider" : "type")} style={{ flex: 1, background: "var(--c-bg-card)", border: "1px solid var(--c-border)", color: "var(--c-text-secondary)", borderRadius: 6, padding: 8, fontSize: 13, cursor: "pointer" }}>
                  <ArrowLeft size={12} style={{ marginRight: 4 }} /> Back
                </button>
              )}
              <button onClick={submit} disabled={busy} style={{ flex: 2, background: busy ? "#374151" : "#4f46e5", border: "none", color: "#fff", borderRadius: 6, padding: 8, fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer" }}>
                {busy ? (isEdit ? "Updating…" : "Connecting…") : (isEdit ? "Update" : "Connect")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
