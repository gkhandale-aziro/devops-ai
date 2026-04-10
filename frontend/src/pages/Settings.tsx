import { useState, useEffect } from "react";
import {
  Settings as SettingsIcon,
  Bot,
  Palette,
  Keyboard,
  Info,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { api } from "../api/client";
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
  const [models, setModels] = useState<string[]>([]);
  const [current, setCurrent] = useState({ tool_model: "", answer_model: "" });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.models
      .list()
      .then((data) => {
        setModels(data.ollama ?? []);
        setCurrent(data.current);
      })
      .catch(() => toast.error("Failed to load AI models"))
      .finally(() => setLoading(false));
  }, []);

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
            style={{ color: "var(--c-accent, #6366f1)" }}
          />
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "var(--c-text-primary, #f1f5f9)",
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
              {loading ? (
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--c-text-muted, #64748b)",
                  }}
                >
                  Loading models...
                </p>
              ) : models.length === 0 ? (
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--c-text-muted, #64748b)",
                  }}
                >
                  No models available from Ollama.
                </p>
              ) : (
                <div className={cn("flex flex-col gap-4")}>
                  {(
                    [
                      ["tool_model", "Tool Model"],
                      ["answer_model", "Answer Model"],
                    ] as const
                  ).map(([field, label]) => (
                    <div key={field}>
                      <label
                        htmlFor={field}
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--c-text-secondary, #94a3b8)",
                          display: "block",
                          marginBottom: 6,
                        }}
                      >
                        {label}
                      </label>
                      <select
                        id={field}
                        value={current[field]}
                        onChange={(e) => updateModel(field, e.target.value)}
                        style={{
                          width: "100%",
                          padding: "8px 12px",
                          borderRadius: 8,
                          border: "1px solid var(--c-border, #1a2235)",
                          background: "var(--c-bg-base, #0d1117)",
                          color: "var(--c-text-primary, #e2e8f0)",
                          fontSize: 13,
                          outline: "none",
                          cursor: "pointer",
                        }}
                      >
                        {models.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
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
                    color: "var(--c-text-secondary, #94a3b8)",
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
                        color: "var(--c-text-secondary, #94a3b8)",
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
                        border: "1px solid var(--c-border, #1a2235)",
                        background: "var(--c-bg-base, #0d1117)",
                        color: "var(--c-text-muted, #64748b)",
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
                    color: "var(--c-text-secondary, #94a3b8)",
                  }}
                >
                  <strong style={{ color: "var(--c-text-primary, #f1f5f9)" }}>
                    AziroOps
                  </strong>{" "}
                  — DevOps AI Platform
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--c-text-secondary, #94a3b8)",
                  }}
                >
                  Connected targets:{" "}
                  <strong style={{ color: "var(--c-text-primary, #f1f5f9)" }}>
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
