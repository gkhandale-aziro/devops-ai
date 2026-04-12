/**
 * tabs.test.tsx — tests for dashboard tab components and utility functions.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../api/client", () => ({
  api: {
    resource: vi.fn().mockResolvedValue({ describe: "test", logs: "log output" }),
    tab: vi.fn(),
    metrics: vi.fn().mockResolvedValue({}),
    health: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../../hooks/useMetrics", () => ({
  useMetrics: () => ({ data: {}, loading: false, error: null }),
}));

vi.mock("../../components/ui/metric-chart", () => ({
  MetricChart: ({ label }: { label: string }) => (
    <div data-testid={`metric-chart-${label}`}>{label}</div>
  ),
  MiniSpark: () => <div data-testid="mini-spark" />,
}));

vi.mock("../../components/ui/time-range-picker", () => ({
  TimeRangePicker: ({ value, onChange }: any) => (
    <select
      data-testid="time-range"
      value={value}
      onChange={(e: any) => onChange(e.target.value)}
    >
      <option value="1h">1h</option>
    </select>
  ),
}));

vi.mock("../../components/ui/health-summary", () => ({
  HealthSummaryBar: () => <div data-testid="health-summary" />,
}));

vi.mock("../../components/ui/empty-state", () => ({
  EmptyState: ({ title }: { title: string }) => (
    <div data-testid="empty-state">{title}</div>
  ),
}));

vi.mock("./tables", () => ({
  KubectlTable: ({ raw, emptyMessage }: any) => (
    <div data-testid="kubectl-table">{raw || emptyMessage}</div>
  ),
  ResourceModal: () => <div data-testid="resource-modal" />,
  hasKubectlData: (raw: string) =>
    raw.includes("\n") && raw.trim().split("\n").length > 1,
  serviceTypeColorFn: () => null,
  pvStatusColorFn: () => null,
}));

vi.mock("./primitives", () => ({
  RingChart: ({ pct }: { pct: number }) => (
    <div data-testid="ring-chart">{pct}%</div>
  ),
  Card: ({ title, children }: any) => (
    <div data-testid="card">
      <div>{title}</div>
      <div>{children}</div>
    </div>
  ),
  Pre: ({ children }: any) => <pre data-testid="pre">{children}</pre>,
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import {
  OverviewTab,
  GenericTab,
  EventsTab,
  ServicesTab,
  WorkloadsTab,
  parseWorkloadCounts,
  K8sStorageTab,
  NetworkTab,
  DockerContainersTab,
  DockerVolumesTab,
  DockerImagesTab,
  DockerStatsTab,
  SSHServicesTab,
  ProcessesTab,
  SecurityTab,
} from "./tabs";

// ── Sample kubectl data ──────────────────────────────────────────────────────

const PODS_OUTPUT = `NAMESPACE   NAME   READY   STATUS   RESTARTS   AGE
default     nginx  1/1     Running  0          1d
default     redis  0/1     Pending  0          1h`;

const DEPLOY_OUTPUT = `NAMESPACE   NAME    READY   UP-TO-DATE   AVAILABLE   AGE
default     nginx   2/2     2            2           1d
default     redis   1/3     3            1           1h`;

const DAEMONSET_OUTPUT = `NAMESPACE   NAME      DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   AGE
default     fluentd   3         3         3       3            3           1d
default     monitor   2         2         1       2            1           1h`;

const EVENTS_OUTPUT = `NAMESPACE   LAST SEEN   TYPE      REASON    OBJECT       MESSAGE
default     2m          Warning   Failed    pod/nginx    Back-off
default     5m          Normal    Pulled    pod/redis    Pulled image`;

const SERVICES_OUTPUT = `NAMESPACE   NAME        TYPE           CLUSTER-IP    PORT(S)   AGE
default     kubernetes  ClusterIP      10.96.0.1     443/TCP   1d
default     my-lb       LoadBalancer   10.96.0.2     80/TCP    1h
default     my-np       NodePort       10.96.0.3     8080/TCP  2h`;

const OVERVIEW_DATA = {
  uptime:
    " 14:32:01 up 5 days,  3:21,  2 users,  load average: 0.42, 0.38, 0.35",
  memory: "Mem:        16384     8192     4096",
  disk: "/dev/sda1   100G   60G   40G   60%   /",
  cpu: "%Cpu(s):  25.3 us,  5.1 sy,  0.0 ni, 69.2 id",
  os: 'PRETTY_NAME="Ubuntu 22.04 LTS"',
  failed_svc: "",
  top_procs: "PID  USER  %CPU  %MEM  COMMAND\n1234 root  12.3  4.5  node",
};

// ── parseWorkloadCounts (pure function) ──────────────────────────────────────

describe("parseWorkloadCounts", () => {
  it("returns zeros for empty input", () => {
    const result = parseWorkloadCounts("", "Deployments");
    expect(result).toEqual({ total: 0, ready: 0, notReady: 0 });
  });

  it("returns zeros for header-only input", () => {
    const result = parseWorkloadCounts(
      "NAMESPACE   NAME   READY   UP-TO-DATE   AVAILABLE   AGE",
      "Deployments"
    );
    expect(result).toEqual({ total: 0, ready: 0, notReady: 0 });
  });

  it("parses fully ready deployments", () => {
    const raw = `NAMESPACE   NAME    READY   UP-TO-DATE   AVAILABLE   AGE
default     nginx   2/2     2            2           1d`;
    const result = parseWorkloadCounts(raw, "Deployments");
    expect(result).toEqual({ total: 1, ready: 1, notReady: 0 });
  });

  it("parses partially ready deployments as notReady", () => {
    const result = parseWorkloadCounts(DEPLOY_OUTPUT, "Deployments");
    expect(result.total).toBe(2);
    expect(result.ready).toBe(1); // nginx 2/2
    expect(result.notReady).toBe(1); // redis 1/3
  });

  it("parses multiple deployments correctly", () => {
    const raw = `NAMESPACE   NAME    READY   UP-TO-DATE   AVAILABLE   AGE
default     app1    3/3     3            3           1d
default     app2    2/2     2            2           2d
default     app3    0/1     1            0           5m`;
    const result = parseWorkloadCounts(raw, "Deployments");
    expect(result).toEqual({ total: 3, ready: 2, notReady: 1 });
  });

  it("parses DaemonSets using DESIRED vs READY columns", () => {
    const result = parseWorkloadCounts(DAEMONSET_OUTPUT, "DaemonSets");
    expect(result.total).toBe(2);
    expect(result.ready).toBe(1); // fluentd 3/3
    expect(result.notReady).toBe(1); // monitor 1<2
  });

  it("treats DaemonSets with desired=0 as ready", () => {
    const raw = `NAMESPACE   NAME   DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   AGE
default     idle   0         0         0       0            0           1d`;
    const result = parseWorkloadCounts(raw, "DaemonSets");
    expect(result).toEqual({ total: 1, ready: 1, notReady: 0 });
  });

  it("parses pods via READY column fraction", () => {
    const result = parseWorkloadCounts(PODS_OUTPUT, "Pods");
    expect(result.total).toBe(2);
    expect(result.ready).toBe(1); // nginx 1/1
    expect(result.notReady).toBe(1); // redis 0/1
  });

  it("ignores blank lines in the output", () => {
    const raw = `NAMESPACE   NAME    READY   UP-TO-DATE   AVAILABLE   AGE
default     nginx   2/2     2            2           1d

default     redis   1/3     3            1           1h
`;
    const result = parseWorkloadCounts(raw, "Deployments");
    expect(result.total).toBe(2);
  });
});

// ── OverviewTab ──────────────────────────────────────────────────────────────

describe("OverviewTab", () => {
  it("renders all four metric cards", () => {
    render(<OverviewTab data={OVERVIEW_DATA} />);
    expect(screen.getByText("CPU Usage")).toBeInTheDocument();
    expect(screen.getByText("Memory")).toBeInTheDocument();
    expect(screen.getByText("Disk")).toBeInTheDocument();
    expect(screen.getByText("Uptime")).toBeInTheDocument();
  });

  it("parses CPU percentage from top output", () => {
    render(<OverviewTab data={OVERVIEW_DATA} />);
    const cpuValues = screen.getAllByText("25.3%");
    // Appears in both the RingChart mock and the card value
    expect(cpuValues.length).toBeGreaterThanOrEqual(1);
  });

  it("parses memory usage in GB", () => {
    render(<OverviewTab data={OVERVIEW_DATA} />);
    // 8192 / 1024 = 8
    expect(screen.getByText("8G")).toBeInTheDocument();
  });

  it("parses disk percentage", () => {
    render(<OverviewTab data={OVERVIEW_DATA} />);
    // 60% appears in both the RingChart mock and the card subtitle
    const matches = screen.getAllByText(/60%/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it("parses uptime string", () => {
    render(<OverviewTab data={OVERVIEW_DATA} />);
    expect(screen.getByText("5 days")).toBeInTheDocument();
  });

  it("parses load average", () => {
    render(<OverviewTab data={OVERVIEW_DATA} />);
    expect(screen.getByText(/Load avg: 0.42/)).toBeInTheDocument();
  });

  it("shows 'All services healthy' when no failed services", () => {
    render(<OverviewTab data={OVERVIEW_DATA} />);
    expect(screen.getByText(/All services healthy/)).toBeInTheDocument();
  });

  it("shows failed services when present", () => {
    const data = {
      ...OVERVIEW_DATA,
      failed_svc: "nginx.service\npostgres.service",
    };
    render(<OverviewTab data={data} />);
    expect(screen.getByText(/nginx\.service/)).toBeInTheDocument();
    expect(screen.getByText(/postgres\.service/)).toBeInTheDocument();
  });

  it("renders HealthSummaryBar when targetId is provided", () => {
    render(<OverviewTab data={OVERVIEW_DATA} targetId="t1" />);
    expect(screen.getByTestId("health-summary")).toBeInTheDocument();
  });

  it("renders ring charts for CPU, Memory, Disk", () => {
    render(<OverviewTab data={OVERVIEW_DATA} />);
    const rings = screen.getAllByTestId("ring-chart");
    // CPU, Memory, Disk get ring charts; Uptime does not
    expect(rings.length).toBe(3);
  });

  it("renders trend charts when targetId is provided", () => {
    render(<OverviewTab data={OVERVIEW_DATA} targetId="t1" />);
    expect(screen.getByTestId("metric-chart-Memory")).toBeInTheDocument();
    expect(screen.getByTestId("metric-chart-Disk")).toBeInTheDocument();
    expect(screen.getByTestId("metric-chart-Load")).toBeInTheDocument();
  });

  it("renders TimeRangePicker when targetId provided", () => {
    render(<OverviewTab data={OVERVIEW_DATA} targetId="t1" />);
    expect(screen.getByTestId("time-range")).toBeInTheDocument();
  });

  it("handles missing data gracefully with dashes", () => {
    render(<OverviewTab data={{}} />);
    // Should not crash and should show fallback values
    expect(screen.getByText("CPU Usage")).toBeInTheDocument();
    // 0% appears in ring chart mock and card value
    const zeros = screen.getAllByText("0%");
    expect(zeros.length).toBeGreaterThanOrEqual(1);
  });
});

// ── GenericTab ────────────────────────────────────────────────────────────────

describe("GenericTab", () => {
  it("shows error message when data.error exists", () => {
    render(<GenericTab data={{ error: "Something went wrong" }} />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("shows empty state when data has no entries", () => {
    render(<GenericTab data={{}} />);
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByText("Nothing to show here")).toBeInTheDocument();
  });

  it("renders key-value pairs as cards", () => {
    render(
      <GenericTab data={{ host_name: "prod-server", os_version: "Ubuntu 22" }} />
    );
    const cards = screen.getAllByTestId("card");
    expect(cards.length).toBe(2);
  });

  it("formats card titles from snake_case keys", () => {
    render(<GenericTab data={{ my_custom_key: "value" }} />);
    expect(screen.getByText("My Custom Key")).toBeInTheDocument();
  });

  it("renders values in Pre blocks", () => {
    render(<GenericTab data={{ info: "some output" }} />);
    const pres = screen.getAllByTestId("pre");
    expect(pres.length).toBe(1);
    expect(pres[0].textContent).toBe("some output");
  });
});

// ── EventsTab ────────────────────────────────────────────────────────────────

describe("EventsTab", () => {
  it("shows event counts from kubectl events output", () => {
    render(<EventsTab data={{ output: EVENTS_OUTPUT }} />);
    expect(screen.getByText("2 Events")).toBeInTheDocument();
  });

  it("shows warning count", () => {
    render(<EventsTab data={{ output: EVENTS_OUTPUT }} />);
    // Warning count appears as a pill; there may be multiple "1"s
    const ones = screen.getAllByText("1");
    expect(ones.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Warning")).toBeInTheDocument();
  });

  it("shows normal count", () => {
    render(<EventsTab data={{ output: EVENTS_OUTPUT }} />);
    expect(screen.getByText("Normal")).toBeInTheDocument();
  });

  it("shows '0 Events' for empty data", () => {
    render(<EventsTab data={{ output: "" }} />);
    expect(screen.getByText("0 Events")).toBeInTheDocument();
  });

  it("shows '0 Events' for header-only output", () => {
    render(
      <EventsTab
        data={{
          output:
            "NAMESPACE   LAST SEEN   TYPE   REASON   OBJECT   MESSAGE",
        }}
      />
    );
    expect(screen.getByText("0 Events")).toBeInTheDocument();
  });

  it("renders KubectlTable with raw data", () => {
    render(<EventsTab data={{ output: EVENTS_OUTPUT }} />);
    const table = screen.getByTestId("kubectl-table");
    expect(table.textContent).toContain("Warning");
  });

  it("renders KubectlTable empty message for no data", () => {
    render(<EventsTab data={{ output: "" }} />);
    const table = screen.getByTestId("kubectl-table");
    expect(table.textContent).toContain("No events in this namespace");
  });
});

// ── ServicesTab ───────────────────────────────────────────────────────────────

describe("ServicesTab", () => {
  it("shows total service count", () => {
    render(<ServicesTab data={{ services: SERVICES_OUTPUT }} />);
    expect(screen.getByText("3 Services")).toBeInTheDocument();
  });

  it("shows service type pills for LoadBalancer and NodePort", () => {
    render(<ServicesTab data={{ services: SERVICES_OUTPUT }} />);
    expect(screen.getByText("LoadBalancer")).toBeInTheDocument();
    expect(screen.getByText("NodePort")).toBeInTheDocument();
  });

  it("shows '0 Services' for empty data", () => {
    render(<ServicesTab data={{ services: "" }} />);
    expect(screen.getByText("0 Services")).toBeInTheDocument();
  });

  it("renders KubectlTable with raw data", () => {
    render(<ServicesTab data={{ services: SERVICES_OUTPUT }} />);
    const table = screen.getByTestId("kubectl-table");
    expect(table.textContent).toContain("NAMESPACE");
  });

  it("renders KubectlTable empty message for no services", () => {
    render(<ServicesTab data={{ services: "" }} />);
    const table = screen.getByTestId("kubectl-table");
    expect(table.textContent).toContain("No services found");
  });
});

// ── WorkloadsTab ─────────────────────────────────────────────────────────────

describe("WorkloadsTab", () => {
  const workloadData = {
    deployments: DEPLOY_OUTPUT,
    statefulsets: "",
    daemonsets: DAEMONSET_OUTPUT,
    replicasets: "",
    jobs: "",
    cronjobs: "",
  };

  it("shows summary bar with total workload count", () => {
    render(<WorkloadsTab data={workloadData} />);
    // Total: 2 deployments + 2 daemonsets = 4
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Total Workloads")).toBeInTheDocument();
  });

  it("shows ready count in summary bar", () => {
    render(<WorkloadsTab data={workloadData} />);
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("shows not-ready count when failures exist", () => {
    render(<WorkloadsTab data={workloadData} />);
    expect(screen.getByText("Not Ready")).toBeInTheDocument();
  });

  it("renders workload type cards for all 6 categories", () => {
    render(<WorkloadsTab data={workloadData} />);
    // Some labels appear multiple times (card + expanded header), use getAllByText
    expect(screen.getAllByText("Deployments").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("StatefulSets").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("DaemonSets").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("ReplicaSets").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Jobs").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("CronJobs").length).toBeGreaterThanOrEqual(1);
  });

  it("defaults to expanded 'deployments' section", () => {
    render(<WorkloadsTab data={workloadData} />);
    // The expanded detail table shows the KubectlTable for deployments
    const tables = screen.getAllByTestId("kubectl-table");
    // Should have the deployment raw data in the expanded table
    expect(tables.some((t) => t.textContent?.includes("NAMESPACE"))).toBe(
      true
    );
  });

  it("toggles expanded section on card click", () => {
    render(<WorkloadsTab data={workloadData} />);
    // Click DaemonSets card to expand it
    fireEvent.click(screen.getByText("DaemonSets"));
    // The DaemonSet table data should now be visible
    const tables = screen.getAllByTestId("kubectl-table");
    expect(tables.some((t) => t.textContent?.includes("fluentd"))).toBe(true);
  });

  it("collapses section when clicking the same card again", () => {
    render(<WorkloadsTab data={workloadData} />);
    // Deployments is expanded by default; click the card text to collapse
    const deploymentCards = screen.getAllByText("Deployments");
    fireEvent.click(deploymentCards[0]);
    // After collapsing, no detail table should remain for deployments
    const tables = screen.queryAllByTestId("kubectl-table");
    expect(tables.length).toBe(0);
  });

  it("handles all-empty workload data without crashing", () => {
    render(
      <WorkloadsTab
        data={{
          deployments: "",
          statefulsets: "",
          daemonsets: "",
          replicasets: "",
          jobs: "",
          cronjobs: "",
        }}
      />
    );
    // Multiple "0" texts may appear (total, per-section counts)
    const zeros = screen.getAllByText("0");
    expect(zeros.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Total Workloads")).toBeInTheDocument();
  });
});

// ── K8sStorageTab ────────────────────────────────────────────────────────────

describe("K8sStorageTab", () => {
  const PVC_OUTPUT = `NAMESPACE   NAME    STATUS   VOLUME   CAPACITY   ACCESS MODES   STORAGECLASS   AGE
default     data    Bound    pv-1     10Gi       RWO            standard       1d
default     logs    Pending  <none>   <none>     RWO            standard       1h`;

  const PV_OUTPUT = `NAME   CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS   CLAIM         STORAGECLASS   AGE
pv-1   10Gi       RWO            Retain           Bound    default/data  standard       1d`;

  const SC_OUTPUT = `NAME       PROVISIONER               RECLAIMPOLICY   VOLUMEBINDINGMODE   ALLOWVOLUMEEXPANSION   AGE
standard   kubernetes.io/host-path   Delete          Immediate           false                  5d`;

  it("shows PVC, PV, and StorageClass counts", () => {
    render(
      <K8sStorageTab
        data={{ pvcs: PVC_OUTPUT, pvs: PV_OUTPUT, storageclasses: SC_OUTPUT }}
      />
    );
    expect(screen.getByText("PVCs")).toBeInTheDocument();
    expect(screen.getByText("PVs")).toBeInTheDocument();
    expect(screen.getByText("Classes")).toBeInTheDocument();
  });

  it("shows Bound/Pending status counts", () => {
    render(
      <K8sStorageTab
        data={{ pvcs: PVC_OUTPUT, pvs: PV_OUTPUT, storageclasses: SC_OUTPUT }}
      />
    );
    expect(screen.getByText("Bound")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("handles empty storage data", () => {
    render(
      <K8sStorageTab data={{ pvcs: "", pvs: "", storageclasses: "" }} />
    );
    // Should not crash
    expect(screen.getByText("PVCs")).toBeInTheDocument();
  });
});

// ── Shared test data for new tabs ───────────────────────────────────────────

const TARGET = { id: "t1", name: "test", type: "kubernetes" as const, status: "online" as const, config: {} };

const NETWORK_SERVICES = `NAMESPACE   NAME        TYPE           CLUSTER-IP    PORT(S)   AGE
default     kubernetes  ClusterIP      10.96.0.1     443/TCP   1d`;

const NETWORK_INGRESSES = `NAMESPACE   NAME      CLASS   HOSTS       ADDRESS   PORTS   AGE
default     my-ing    nginx   foo.com     1.2.3.4   80      1d`;

const DOCKER_PS = `NAMES   STATUS   IMAGE
nginx   Up 2h   nginx:latest
redis   Exited   redis:7`;

const VOLUME_OUTPUT = `DRIVER   VOLUME NAME
local    my-vol
local    db-data`;

const IMAGE_OUTPUT = `REPOSITORY   TAG      SIZE
nginx        latest   150MB
redis        7        100MB`;

const SSH_SERVICES_ALL = `UNIT                  LOAD    ACTIVE   SUB      DESCRIPTION
nginx.service         loaded  active   running  A web server
cron.service          loaded  active   exited   Regular cron
bad.service           loaded  failed   failed   Broken svc`;

const SSH_SERVICES_FAILED = `UNIT           LOAD    ACTIVE   SUB     DESCRIPTION
bad.service    loaded  failed   failed  Broken svc`;

const FIREWALL_ACTIVE = `Status: active
To   Action   From
80   ALLOW    Anywhere`;

const PROCESS_LOAD = " 14:32:01 up 5 days,  2 users,  load average: 1.23, 0.98, 0.75";

const TOP_CPU = `PID   USER   %CPU   %MEM   COMMAND
1234  root   45.2   3.1    node`;

const TOP_MEM = `PID   USER   %CPU   %MEM   COMMAND
5678  root   2.1    68.5   java`;

// ── NetworkTab ──────────────────────────────────────────────────────────────

describe("NetworkTab", () => {
  it("shows count pills for services and ingresses", () => {
    render(
      <NetworkTab
        data={{ services: NETWORK_SERVICES, ingresses: NETWORK_INGRESSES }}
        target={TARGET}
      />
    );
    // Text appears in both the summary pill and the Card title mock
    expect(screen.getAllByText("Services").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Ingresses").length).toBeGreaterThanOrEqual(1);
  });

  it("shows correct count values in summary pills", () => {
    render(
      <NetworkTab
        data={{ services: NETWORK_SERVICES, ingresses: NETWORK_INGRESSES }}
        target={TARGET}
      />
    );
    // 1 service row, 1 ingress row
    const ones = screen.getAllByText("1");
    expect(ones.length).toBeGreaterThanOrEqual(2);
  });

  it("renders KubectlTable for each section with data", () => {
    render(
      <NetworkTab
        data={{ services: NETWORK_SERVICES, ingresses: NETWORK_INGRESSES }}
        target={TARGET}
      />
    );
    const tables = screen.getAllByTestId("kubectl-table");
    expect(tables.length).toBeGreaterThanOrEqual(2);
  });

  it("does not render sections for missing data keys", () => {
    render(<NetworkTab data={{ services: NETWORK_SERVICES }} target={TARGET} />);
    expect(screen.getAllByText("Services").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Ingresses")).not.toBeInTheDocument();
  });
});

// ── DockerContainersTab ─────────────────────────────────────────────────────

describe("DockerContainersTab", () => {
  it("shows total container count", () => {
    render(<DockerContainersTab data={{ output: DOCKER_PS }} target={TARGET} />);
    expect(screen.getByText("2 Containers")).toBeInTheDocument();
  });

  it("shows running and exited count pills", () => {
    render(<DockerContainersTab data={{ output: DOCKER_PS }} target={TARGET} />);
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Exited")).toBeInTheDocument();
  });

  it("shows '0 Containers' for empty output", () => {
    render(<DockerContainersTab data={{ output: "" }} target={TARGET} />);
    expect(screen.getByText("0 Containers")).toBeInTheDocument();
  });

  it("renders KubectlTable with container data", () => {
    render(<DockerContainersTab data={{ output: DOCKER_PS }} target={TARGET} />);
    const table = screen.getByTestId("kubectl-table");
    expect(table.textContent).toContain("nginx");
  });
});

// ── DockerVolumesTab ────────────────────────────────────────────────────────

describe("DockerVolumesTab", () => {
  it("shows volume count pill", () => {
    render(<DockerVolumesTab data={{ output: VOLUME_OUTPUT }} target={TARGET} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Volumes")).toBeInTheDocument();
  });

  it("shows zero count for empty output", () => {
    render(<DockerVolumesTab data={{ output: "" }} target={TARGET} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders KubectlTable with volume data", () => {
    render(<DockerVolumesTab data={{ output: VOLUME_OUTPUT }} target={TARGET} />);
    const table = screen.getByTestId("kubectl-table");
    expect(table.textContent).toContain("my-vol");
  });
});

// ── DockerImagesTab ─────────────────────────────────────────────────────────

describe("DockerImagesTab", () => {
  it("shows image count pill", () => {
    render(<DockerImagesTab data={{ output: IMAGE_OUTPUT }} target={TARGET} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Images")).toBeInTheDocument();
  });

  it("shows zero count for empty output", () => {
    render(<DockerImagesTab data={{ output: "" }} target={TARGET} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders KubectlTable with image data", () => {
    render(<DockerImagesTab data={{ output: IMAGE_OUTPUT }} target={TARGET} />);
    const table = screen.getByTestId("kubectl-table");
    expect(table.textContent).toContain("nginx");
  });
});

// ── DockerStatsTab ──────────────────────────────────────────────────────────

describe("DockerStatsTab", () => {
  const STATS_OUTPUT = `NAME    CPU %   MEM %   MEM USAGE
nginx   25.30   10.50   100MiB`;

  it("shows 'Container Stats' header", () => {
    render(<DockerStatsTab data={{ output: STATS_OUTPUT }} target={TARGET} />);
    expect(screen.getByText("Container Stats")).toBeInTheDocument();
  });

  it("shows snapshot subtitle", () => {
    render(<DockerStatsTab data={{ output: STATS_OUTPUT }} target={TARGET} />);
    expect(screen.getByText(/CPU & memory usage/)).toBeInTheDocument();
  });

  it("renders KubectlTable with stats data", () => {
    render(<DockerStatsTab data={{ output: STATS_OUTPUT }} target={TARGET} />);
    const table = screen.getByTestId("kubectl-table");
    expect(table.textContent).toContain("nginx");
  });
});

// ── SSHServicesTab ──────────────────────────────────────────────────────────

describe("SSHServicesTab", () => {
  it("shows total service count", () => {
    render(<SSHServicesTab data={{ all: SSH_SERVICES_ALL, failed: SSH_SERVICES_FAILED }} target={TARGET} />);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Services")).toBeInTheDocument();
  });

  it("shows running, failed, and exited counts", () => {
    render(<SSHServicesTab data={{ all: SSH_SERVICES_ALL, failed: SSH_SERVICES_FAILED }} target={TARGET} />);
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Exited")).toBeInTheDocument();
  });

  it("renders health bar when services exist", () => {
    const { container } = render(
      <SSHServicesTab data={{ all: SSH_SERVICES_ALL, failed: SSH_SERVICES_FAILED }} target={TARGET} />
    );
    // Health bar is a 120px wide div; check it exists by looking for the bar container
    const bars = container.querySelectorAll("div[style*='width: 120']");
    expect(bars.length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'All services healthy' when no failed services", () => {
    render(<SSHServicesTab data={{ all: SSH_SERVICES_ALL, failed: "" }} target={TARGET} />);
    expect(screen.getByText(/All services healthy/)).toBeInTheDocument();
  });
});

// ── ProcessesTab ────────────────────────────────────────────────────────────

describe("ProcessesTab", () => {
  const processData = {
    load: PROCESS_LOAD,
    count: "142",
    top_cpu: TOP_CPU,
    top_mem: TOP_MEM,
  };

  it("shows load average value", () => {
    render(<ProcessesTab data={processData} />);
    expect(screen.getByText("1.23")).toBeInTheDocument();
  });

  it("shows 5m and 15m load values", () => {
    render(<ProcessesTab data={processData} />);
    expect(screen.getByText(/5m: 0.98/)).toBeInTheDocument();
    expect(screen.getByText(/15m: 0.75/)).toBeInTheDocument();
  });

  it("shows total process count", () => {
    render(<ProcessesTab data={processData} />);
    expect(screen.getByText("142")).toBeInTheDocument();
    expect(screen.getByText("Total Processes")).toBeInTheDocument();
  });

  it("shows top CPU consumer with percentage", () => {
    render(<ProcessesTab data={processData} />);
    expect(screen.getByText("45.2%")).toBeInTheDocument();
    expect(screen.getByText("node")).toBeInTheDocument();
  });

  it("shows top memory consumer with percentage", () => {
    render(<ProcessesTab data={processData} />);
    expect(screen.getByText("68.5%")).toBeInTheDocument();
    expect(screen.getByText("java")).toBeInTheDocument();
  });

  it("handles missing data with dashes", () => {
    render(<ProcessesTab data={{}} />);
    // Load average shows dash when missing
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });
});

// ── SecurityTab ─────────────────────────────────────────────────────────────

describe("SecurityTab", () => {
  const securityData = {
    active_users: "root     pts/0\nadmin    pts/1",
    last_logins: "root     pts/0   192.168.1.1\nadmin    pts/1   192.168.1.2\nguest    pts/2   10.0.0.1",
    failed_logins: "hacker   ssh:notty   1.2.3.4",
    firewall: FIREWALL_ACTIVE,
  };

  it("shows Security Overview header", () => {
    render(<SecurityTab data={securityData} />);
    expect(screen.getByText("Security Overview")).toBeInTheDocument();
  });

  it("shows active user count pill", () => {
    render(<SecurityTab data={securityData} />);
    // Text appears in both the summary pill and the Card title mock
    expect(screen.getAllByText("Active Users").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows recent login count pill", () => {
    render(<SecurityTab data={securityData} />);
    // Text appears in both the summary pill and the Card title mock
    expect(screen.getAllByText("Recent Logins").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("shows failed attempts count pill", () => {
    render(<SecurityTab data={securityData} />);
    expect(screen.getByText("Failed Attempts")).toBeInTheDocument();
  });

  it("shows firewall status as Active", () => {
    render(<SecurityTab data={securityData} />);
    expect(screen.getByText("Firewall")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows firewall as Not Detected when data is empty", () => {
    render(<SecurityTab data={{ ...securityData, firewall: "" }} />);
    expect(screen.getByText("Not Detected")).toBeInTheDocument();
  });
});
