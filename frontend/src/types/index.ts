// ── Target ────────────────────────────────────────────────────────────────────

export type TargetType =
  | "ssh" | "kubernetes" | "docker"
  | "aws" | "gcp" | "azure" | "terraform" | "local";

export type TargetStatus = "online" | "offline" | "unknown";

export interface Target {
  id:     string;
  name:   string;
  type:   TargetType;
  status: TargetStatus;
  config: Record<string, string>;
}

// ── Triage levels ─────────────────────────────────────────────────────────────

export type TriageLevel = "SEV1" | "SEV2" | "SEV3";

/**
 * SEV1 — Critical: node down, disk pressure, ImagePullBackOff — immediate action
 * SEV2 — Warning:  CrashLoop, OOMKilled, backoff — needs investigation
 * SEV3 — Info:     minor / unknown warning — logged for visibility
 */
export const LEVEL_LABELS: Record<TriageLevel, string> = {
  SEV1: "Critical",
  SEV2: "Warning",
  SEV3: "Info",
};

export const LEVEL_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  SEV1: { border: "#f43f5e", bg: "#2a0011", text: "#fb7185" },
  SEV2: { border: "#f59e0b", bg: "#2a1a00", text: "#fbbf24" },
  SEV3: { border: "#06b6d4", bg: "#0c2233", text: "#22d3ee" },
};

const _FALLBACK_COLOR = { border: "#64748b", bg: "#1e293b", text: "#94a3b8" };

/** Safe accessor — returns fallback for unknown levels (e.g. legacy 'L2' data). */
export function levelColor(level: string) {
  return LEVEL_COLORS[level] ?? _FALLBACK_COLOR;
}

// ── Monitor alert (SSE) ───────────────────────────────────────────────────────

export interface MonitorAlert {
  type:      "monitor_alert";
  level:     TriageLevel;
  reason:    string;
  object:    string;
  namespace: string;
  message:   string;
  source:    string;
}

export type SSEEvent = MonitorAlert | { type: "keepalive" };

// ── Stored event (DB) ─────────────────────────────────────────────────────────

export interface Snapshot {
  id:        number;
  event_id:  number;
  timestamp: string;
  kind:      "describe" | "logs" | "logs_previous" | "events";
  content:   string;
}

export interface Analysis {
  id:          number;
  event_id:    number;
  timestamp:   string;
  diagnosis:   string;
  remediation: string;
}

export type IncidentStatus = "open" | "acknowledged" | "resolved";

export interface StoredEvent {
  id:              number;
  timestamp:       string;
  source:          string;
  level:           string;
  reason:          string;
  object:          string;
  namespace:       string;
  message:         string;
  status:          IncidentStatus;
  last_diagnosis?: string;
  snapshots?:      Snapshot[];
  analyses?:       Analysis[];
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface TopFailing {
  object:      string;
  namespace:   string;
  count:       number;
  last_seen:   string;
  worst_level: TriageLevel;
}

export interface Stats {
  counts:      Partial<Record<TriageLevel, number>>;
  top_failing: TopFailing[];
  recent:      StoredEvent[];
}

// ── Chat ──────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role:    "user" | "assistant" | "system";
  content: string;
}

export interface ChatSession {
  id:        string;
  title:     string;
  created:   string;
  updated:   string;
}

// ── Tab commands ──────────────────────────────────────────────────────────────

export type TabId =
  | "overview" | "kubernetes" | "logs" | "network" | "storage"  // ssh/local
  | "nodes" | "pods" | "deployments" | "services" | "events"    // kubernetes
  | "workloads" | "k8s_storage" | "ingress"                     // kubernetes extra
  | "containers" | "images" | "networks" | "volumes" | "stats"  // docker
  | "account" | "ec2" | "s3" | "eks" | "rds"                   // aws
  | "compute" | "gke" | "iam"                                   // gcp
  | "vms" | "aks" | "groups"                                    // azure
  | "state" | "plan" | "outputs";                               // terraform

export interface Tab {
  id:    TabId;
  label: string;
}

export const TABS_BY_TYPE: Record<TargetType, Tab[]> = {
  ssh: [
    { id: "overview",   label: "Overview"   },
    { id: "kubernetes", label: "Kubernetes" },
    { id: "logs",       label: "Logs"       },
    { id: "network",    label: "Network"    },
    { id: "storage",    label: "Storage"    },
  ],
  local: [
    { id: "overview",   label: "Overview"   },
    { id: "kubernetes", label: "Kubernetes" },
    { id: "logs",       label: "Logs"       },
    { id: "network",    label: "Network"    },
    { id: "storage",    label: "Storage"    },
  ],
  kubernetes: [
    { id: "nodes",        label: "Nodes"       },
    { id: "pods",         label: "Pods"        },
    { id: "workloads",    label: "Workloads"   },
    { id: "services",     label: "Services"    },
    { id: "ingress",      label: "Ingress"     },
    { id: "k8s_storage",  label: "Storage"     },
    { id: "network",      label: "Network"     },
    { id: "events",       label: "Events"      },
  ],
  docker: [
    { id: "containers", label: "Containers" },
    { id: "images",     label: "Images"     },
    { id: "networks",   label: "Networks"   },
    { id: "volumes",    label: "Volumes"    },
    { id: "stats",      label: "Stats"      },
  ],
  aws: [
    { id: "account", label: "Account" },
    { id: "ec2",     label: "EC2"     },
    { id: "s3",      label: "S3"      },
    { id: "eks",     label: "EKS"     },
    { id: "rds",     label: "RDS"     },
  ],
  gcp: [
    { id: "account", label: "Account" },
    { id: "compute", label: "Compute" },
    { id: "gke",     label: "GKE"     },
    { id: "storage", label: "Storage" },
    { id: "iam",     label: "IAM"     },
  ],
  azure: [
    { id: "account", label: "Account" },
    { id: "vms",     label: "VMs"     },
    { id: "aks",     label: "AKS"     },
    { id: "storage", label: "Storage" },
    { id: "groups",  label: "Groups"  },
  ],
  terraform: [
    { id: "state",   label: "State"   },
    { id: "plan",    label: "Plan"    },
    { id: "outputs", label: "Outputs" },
  ],
};
