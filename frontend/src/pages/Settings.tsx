import { useState, useEffect, useRef } from "react";
import {
  Settings as SettingsIcon,
  Bot,
  Palette,
  Keyboard,
  Info,
  Server,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { api, type ModelHealthStatus } from "../api/client";
import { ThemeToggle } from "../components/ThemeContext";
import { toast } from "../utils/toast";
import { cn } from "@/lib/utils";

interface Props {
  targetCount: number;
}

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: "Cmd/Ctrl + K", description: "Command palette" },
  { keys: "Esc", description: "Close modals / panels" },
  { keys: "\u2191 / \u2193", description: "Navigate rows" },
  { keys: "Enter", description: "Select / open" },
];

export function Settings({ targetCount }: Props) {
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [current, setCurrent] = useState({ tool_model: "", answer_model: "" });
  const [health, setHealth] = useState<ModelHealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [ollamaUrlDraft, setOllamaUrlDraft] = useState("");
  const [ollamaUrlTesting, setOllamaUrlTesting] = useState(false);
  const [ollamaUrlResult, setOllamaUrlResult] = useState<{ ok: boolean; models: number; error: string } | null>(null);

  useEffect(() => {
    api.models
      .list()
      .then((data) => {
        setOllamaModels(data.ollama ?? []);
        setCurrent(data.current);
        if (data.ollama_url) {
          setOllamaUrl(data.ollama_url);
          setOllamaUrlDraft(data.ollama_url);
        }
      })
      .catch(() => toast.error("Failed to load AI models"))
      .finally(() => setLoading(false));
    api.modelHealth().then(setHealth).catch(() => {});
  }, []);

  async function saveOllamaUrl() {
    setOllamaUrlTesting(true);
    setOllamaUrlResult(null);
    try {
      const res = await api.models.ollamaUrl.set(ollamaUrlDraft.trim());
      if (res.ok) {
        setOllamaUrl(ollamaUrlDraft.trim());
        setOllamaUrlResult({ ok: true, models: res.models, error: "" });
        toast.success(`Ollama connected — ${res.models} model${res.models === 1 ? "" : "s"} found`);
        // Refresh model list
        const data = await api.models.list();
        setOllamaModels(data.ollama ?? []);
      } else {
        setOllamaUrlResult({ ok: false, models: 0, error: res.error });
      }
    } catch (e) {
      setOllamaUrlResult({ ok: false, models: 0, error: (e as Error)?.message ?? "Connection failed" });
    } finally {
      setOllamaUrlTesting(false);
    }
  }

  async function updateModel(
    field: "tool_model" | "answer_model",
    value: string,
  ) {
    try {
      const updated = await api.models.update({ [field]: value });
      setCurrent(updated);
      toast.success(`Model updated to ${value}`);
    } catch {
      toast.error("Failed to update model");
    }
  }

  return (
    <div
      className={cn("flex-1 overflow-y-auto")}
      style={{ padding: "32px 24px" }}
    >
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        {/* Page header */}
        <div
          className={cn("flex items-center gap-3")}
          style={{ marginBottom: 28 }}
        >
          <SettingsIcon
            size={22}
            style={{ color: "var(--c-accent)" }}
          />
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "var(--c-text-primary)",
              margin: 0,
            }}
          >
            Settings
          </h1>
        </div>

        <div className={cn("flex flex-col gap-5")}>
          {/* ── AI Model Selection ──────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className={cn("flex items-center gap-2")}>
                <Bot size={16} /> AI Model Selection
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Model health status */}
              {health && health.status !== "healthy" && (
                <div style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  marginBottom: 12,
                  fontSize: 12,
                  lineHeight: 1.5,
                  background: health.status === "fallback" ? "var(--c-sev2-bg)" : "var(--c-sev1-bg)",
                  border: `1px solid ${health.status === "fallback" ? "var(--c-sev2)" : "var(--c-sev1)"}`,
                  color: health.status === "fallback" ? "var(--c-sev2)" : "var(--c-sev1)",
                }}>
                  {health.status === "fallback" ? (
                    <>
                      <strong>Quota exhausted</strong> — using fallback: <strong>{health.fallback_model}</strong>.
                      Auto-retries primary every 5 min.
                    </>
                  ) : (
                    <>
                      <strong>Quota exhausted</strong> — AI features unavailable.
                      Install Ollama for automatic fallback, or change model below.
                    </>
                  )}
                </div>
              )}
              {health && health.status === "healthy" && (
                <div style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  marginBottom: 12,
                  fontSize: 12,
                  background: "var(--c-green-bg, #22c55e18)",
                  border: "1px solid var(--c-green, #22c55e)",
                  color: "var(--c-green, #22c55e)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
                  Model healthy
                </div>
              )}
              {loading ? (
                <p style={{ fontSize: 13, color: "var(--c-text-muted)" }}>
                  Loading models...
                </p>
              ) : (
                <div className={cn("flex flex-col gap-4")}>
                  {(
                    [
                      ["tool_model", "Tool Model", "Model for tool calls (fast)"],
                      ["answer_model", "Answer Model", "Model for final answers (smart)"],
                    ] as const
                  ).map(([field, label, hint]) => (
                    <div key={field}>
                      <label
                        htmlFor={field}
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--c-text-secondary)",
                          display: "block",
                          marginBottom: 4,
                        }}
                      >
                        {label}
                      </label>
                      <p style={{ fontSize: 11, color: "var(--c-text-muted)", margin: "0 0 6px" }}>{hint}</p>
                      {ollamaModels.length > 0 ? (
                        <select
                          id={field}
                          value={current[field]}
                          onChange={(e) => updateModel(field, e.target.value)}
                          style={{
                            width: "100%",
                            padding: "8px 12px",
                            borderRadius: 8,
                            border: "1px solid var(--c-border)",
                            background: "var(--c-bg-base)",
                            color: "var(--c-text-primary)",
                            fontSize: 13,
                            outline: "none",
                            cursor: "pointer",
                          }}
                        >
                          {ollamaModels.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      ) : (
                        <ModelInput
                          id={field}
                          value={current[field]}
                          onSubmit={(v) => updateModel(field, v)}
                        />
                      )}
                    </div>
                  ))}
                  <p style={{ fontSize: 11, color: "var(--c-text-faint)", lineHeight: 1.5, margin: 0 }}>
                    Supports any LiteLLM model: gemini/*, openai/*, ollama/*, anthropic/*, etc.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Ollama URL Configuration ──────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className={cn("flex items-center gap-2")}>
                <Server size={16} /> Ollama Connection
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p style={{ fontSize: 11, color: "var(--c-text-muted)", margin: "0 0 8px", lineHeight: 1.5 }}>
                URL for Ollama API. Use <code style={{ fontSize: 10, padding: "1px 4px", borderRadius: 3, background: "var(--c-bg-base)", border: "1px solid var(--c-border)" }}>host.docker.internal:11434</code> when running in Docker.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  value={ollamaUrlDraft}
                  onChange={e => { setOllamaUrlDraft(e.target.value); setOllamaUrlResult(null); }}
                  onKeyDown={e => { if (e.key === "Enter") saveOllamaUrl(); }}
                  placeholder="http://localhost:11434"
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: `1px solid ${ollamaUrlDraft.trim() !== ollamaUrl ? "var(--c-accent)" : "var(--c-border)"}`,
                    background: "var(--c-bg-base)",
                    color: "var(--c-text-primary)",
                    fontSize: 13,
                    outline: "none",
                  }}
                />
                <button
                  onClick={saveOllamaUrl}
                  disabled={ollamaUrlTesting || !ollamaUrlDraft.trim()}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 8,
                    border: "none",
                    background: ollamaUrlDraft.trim() ? "var(--c-accent)" : "var(--c-bg-raised)",
                    color: ollamaUrlDraft.trim() ? "#fff" : "var(--c-text-faint)",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: ollamaUrlDraft.trim() && !ollamaUrlTesting ? "pointer" : "default",
                    transition: "all .15s",
                    display: "flex", alignItems: "center", gap: 6,
                    opacity: ollamaUrlTesting ? 0.7 : 1,
                  }}
                >
                  {ollamaUrlTesting && <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />}
                  {ollamaUrlTesting ? "Testing..." : "Save & Test"}
                </button>
              </div>
              {ollamaUrlResult && (
                <div style={{
                  marginTop: 8, padding: "6px 10px", borderRadius: 6, fontSize: 12,
                  display: "flex", alignItems: "center", gap: 6,
                  background: ollamaUrlResult.ok ? "var(--c-green-bg, #22c55e18)" : "var(--c-sev1-bg, #ef444418)",
                  border: `1px solid ${ollamaUrlResult.ok ? "var(--c-green, #22c55e)" : "var(--c-sev1, #ef4444)"}`,
                  color: ollamaUrlResult.ok ? "var(--c-green, #22c55e)" : "var(--c-sev1, #ef4444)",
                }}>
                  {ollamaUrlResult.ok
                    ? <><CheckCircle2 size={13} /> Connected — {ollamaUrlResult.models} model{ollamaUrlResult.models === 1 ? "" : "s"} available</>
                    : <><XCircle size={13} /> {ollamaUrlResult.error}</>
                  }
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Appearance ──────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className={cn("flex items-center gap-2")}>
                <Palette size={16} /> Appearance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={cn("flex items-center justify-between")}>
                <span
                  style={{
                    fontSize: 13,
                    color: "var(--c-text-secondary)",
                  }}
                >
                  Day / Night mode
                </span>
                <ThemeToggle />
              </div>
            </CardContent>
          </Card>

          {/* ── Keyboard Shortcuts ──────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className={cn("flex items-center gap-2")}>
                <Keyboard size={16} /> Keyboard Shortcuts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={cn("flex flex-col gap-3")}>
                {SHORTCUTS.map((s) => (
                  <div
                    key={s.keys}
                    className={cn("flex items-center justify-between")}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        color: "var(--c-text-secondary)",
                      }}
                    >
                      {s.description}
                    </span>
                    <kbd
                      style={{
                        fontSize: 11,
                        fontFamily: "monospace",
                        padding: "3px 8px",
                        borderRadius: 5,
                        border: "1px solid var(--c-border)",
                        background: "var(--c-bg-base)",
                        color: "var(--c-text-muted)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* ── About ──────────────────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className={cn("flex items-center gap-2")}>
                <Info size={16} /> About
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={cn("flex flex-col gap-2")}>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--c-text-secondary)",
                  }}
                >
                  <strong style={{ color: "var(--c-text-primary)" }}>
                    AziroOps
                  </strong>{" "}
                  — DevOps AI Platform
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--c-text-secondary)",
                  }}
                >
                  Connected targets:{" "}
                  <strong style={{ color: "var(--c-text-primary)" }}>
                    {targetCount}
                  </strong>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Text input with Enter-to-submit for typing any LiteLLM model string. */
function ModelInput({ id, value, onSubmit }: { id: string; value: string; onSubmit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);

  const changed = draft.trim() !== "" && draft.trim() !== value;

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && changed) onSubmit(draft.trim()); }}
        placeholder="e.g. gemini/gemini-2.5-flash"
        style={{
          flex: 1,
          padding: "8px 12px",
          borderRadius: 8,
          border: `1px solid ${changed ? "var(--c-accent)" : "var(--c-border)"}`,
          background: "var(--c-bg-base)",
          color: "var(--c-text-primary)",
          fontSize: 13,
          outline: "none",
        }}
      />
      <button
        onClick={() => { if (changed) onSubmit(draft.trim()); }}
        disabled={!changed}
        style={{
          padding: "8px 16px",
          borderRadius: 8,
          border: "none",
          background: changed ? "var(--c-accent)" : "var(--c-bg-raised)",
          color: changed ? "#fff" : "var(--c-text-faint)",
          fontSize: 12,
          fontWeight: 600,
          cursor: changed ? "pointer" : "default",
          transition: "all .15s",
        }}
      >
        Save
      </button>
    </div>
  );
}
