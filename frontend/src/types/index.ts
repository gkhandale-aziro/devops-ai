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
  SEV1: { border: "var(--c-sev1)", bg: "var(--c-sev1-bg)", text: "var(--c-sev1)" },
  SEV2: { border: "var(--c-sev2)", bg: "var(--c-sev2-bg)", text: "var(--c-sev2)" },
  SEV3: { border: "var(--c-sev3)", bg: "var(--c-sev3-bg)", text: "var(--c-sev3)" },
};

const _FALLBACK_COLOR = { border: "var(--c-text-muted)", bg: "var(--c-bg-overlay)", text: "var(--c-text-secondary)" };

/** Safe accessor — returns fallback for unknown levels (e.g. legacy 'L2' data). */
export function levelColor(level: string) {
  return LEVEL_COLORS[level] ?? _FALLBACK_COLOR;
}

// ── Monitor alert (SSE) ───────────────────────────────────────────────────────

export interface MonitorAlert {
  type:        "monitor_alert";
  level:       TriageLevel;
  reason:      string;
  object:      string;
  namespace:   string;
  message:     string;
  source:      string;
  target_id:   string;
  target_name: string;
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

// ── Topology ──────────────────────────────────────────────────────────────────

export interface TopologyDeployment {
  namespace: string;
  name:      string;
  ready:     string;
  available: string;
}

export interface TopologyPod {
  namespace: string;
  name:      string;
  ready:     string;
  status:    string;
  restarts:  string;
}

export interface TopologyService {
  namespace: string;
  name:      string;
  type:      string;
  port:      string;
}

export interface TopologyIngress {
  namespace: string;
  name:      string;
  hosts:     string;
}

export interface TopologyResponse {
  deployments: TopologyDeployment[];
  pods:        TopologyPod[];
  services:    TopologyService[];
  ingresses:   TopologyIngress[];
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface SearchHit {
  kind:      string;
  namespace: string;
  name:      string;
  status:    string;
}

export interface SearchResponse {
  results: SearchHit[];
}

// ── Pod status ────────────────────────────────────────────────────────────────

/** Known pod phase / waiting-reason values surfaced in `kubectl get pods`. */
export type PodStatus =
  | "Running" | "Pending" | "Succeeded" | "Completed" | "Terminating"
  | "CrashLoopBackOff" | "ImagePullBackOff" | "ErrImagePull"
  | "CreateContainerConfigError" | "OOMKilled" | "Error" | "Failed"
  | "Init:Error" | "Unknown";

// ── Tab commands ──────────────────────────────────────────────────────────────

export type TabId =
  | "overview" | "services" | "processes" | "logs" | "network" | "storage" | "security"  // ssh/local
  | "nodes" | "pods" | "deployments" | "events"                 // kubernetes
  | "workloads" | "k8s_storage" | "ingress"                     // kubernetes extra
  | "__chat" | "__topology"                                      // virtual tabs
  | "containers" | "images" | "networks" | "volumes" | "stats"  // docker
  | "account" | "ec2" | "s3" | "eks" | "rds"                   // aws
  | "compute" | "gke" | "iam"                                   // gcp
  | "vms" | "aks" | "groups"                                    // azure
  | "state" | "plan" | "outputs";                               // terraform

export interface Tab {
  id:    TabId;
  label: string;
}

// ── Workload Health Summary ─────────────────────────────────────────────────

export interface HealthPods {
  running: number; pending: number; failed: number; succeeded: number; total: number;
}

export interface HealthCountPair {
  ready: number; total: number;
}

export interface HealthContainers {
  running: number; stopped: number; total: number;
}

export interface HealthServices {
  active: number; failed: number; total: number;
}

/** Shape varies by target type — K8s returns pods/deployments/nodes, Docker returns containers, SSH returns services */
export interface HealthSummary {
  pods?:        HealthPods;
  deployments?: HealthCountPair;
  nodes?:       HealthCountPair;
  containers?:  HealthContainers;
  services?:    HealthServices;
}

export const TABS_BY_TYPE: Record<TargetType, Tab[]> = {
  ssh: [
    { id: "overview",   label: "Overview"   },
    { id: "services",   label: "Services"   },
    { id: "processes",  label: "Processes"  },
    { id: "logs",       label: "Logs"       },
    { id: "network",    label: "Network"    },
    { id: "storage",    label: "Storage"    },
    { id: "security",   label: "Security"   },
  ],
  local: [
    { id: "overview",   label: "Overview"   },
    { id: "services",   label: "Services"   },
    { id: "processes",  label: "Processes"  },
    { id: "logs",       label: "Logs"       },
    { id: "network",    label: "Network"    },
    { id: "storage",    label: "Storage"    },
    { id: "security",   label: "Security"   },
  ],
  kubernetes: [
    { id: "workloads",    label: "Workloads"   },
    { id: "nodes",        label: "Nodes"       },
    { id: "pods",         label: "Pods"        },
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
