/**
 * fixtures.ts — canned responses for the /api/v1/* endpoints consumed by
 * the Dashboard. Kept deterministic so Playwright screenshots are stable.
 */
import type { Target, TargetType } from "../src/types";

export const TARGETS: Record<TargetType, Target> = {
  kubernetes: { id: "k8s-1",  name: "prod-cluster",  type: "kubernetes", status: "online", config: {} },
  ssh:        { id: "ssh-1",  name: "web-01",        type: "ssh",        status: "online", config: {} },
  docker:     { id: "dock-1", name: "local-docker",  type: "docker",     status: "online", config: {} },
  local:      { id: "loc-1",  name: "localhost",     type: "local",      status: "online", config: {} },
  aws:        { id: "aws-1",  name: "aws-prod",      type: "aws",        status: "online", config: {} },
  gcp:        { id: "gcp-1",  name: "gcp-prod",      type: "gcp",        status: "online", config: {} },
  azure:      { id: "az-1",   name: "azure-prod",    type: "azure",      status: "online", config: {} },
  terraform:  { id: "tf-1",   name: "infra",         type: "terraform",  status: "online", config: {} },
};

// ── kubectl-style text fixtures ────────────────────────────────────────────

export const PODS = `NAMESPACE     NAME                          READY   STATUS             RESTARTS   AGE
default       web-1                         1/1     Running            0          3d
default       web-2                         1/1     Running            0          3d
default       api-6f7b9c8d4-abc12            1/1     Running            1          2d
kube-system   coredns-7db5b9b8b9-xyz12       1/1     Running            0          10d
kube-system   kube-proxy-ndfg4               1/1     Running            0          10d
staging       worker-7d8f9-pending           0/1     Pending            0          1h
staging       broken-api-6b4c-crash          0/1     CrashLoopBackOff   12         2h`;

export const NODES = `NAME              STATUS   ROLES           AGE   VERSION
node-pool-1-a     Ready    control-plane   15d   v1.29.3
node-pool-1-b     Ready    worker          15d   v1.29.3
node-pool-1-c     Ready    worker          15d   v1.29.3`;

export const EVENTS = `LAST SEEN   TYPE      REASON              OBJECT                        MESSAGE
5m          Normal    Scheduled           pod/web-1                     Successfully assigned default/web-1 to node-pool-1-b
5m          Normal    Pulled              pod/web-1                     Image pulled
2m          Warning   BackOff             pod/broken-api-6b4c-crash     Back-off restarting failed container
1m          Warning   FailedScheduling    pod/worker-7d8f9-pending      0/3 nodes available: insufficient memory`;

export const SERVICES = `NAMESPACE   NAME        TYPE           CLUSTER-IP      EXTERNAL-IP      PORT(S)        AGE
default     web         LoadBalancer   10.0.1.10       34.121.55.10     80:31000/TCP   3d
default     api         ClusterIP      10.0.1.20       <none>           8080/TCP       3d
default     cache       ClusterIP      10.0.1.30       <none>           6379/TCP       3d
kube-system kube-dns    ClusterIP      10.0.0.10       <none>           53/UDP,53/TCP  10d`;

export const DEPLOYMENTS = `NAMESPACE   NAME    READY   UP-TO-DATE   AVAILABLE   AGE
default     web     2/2     2            2           3d
default     api     1/1     1            1           2d
default     worker  0/1     1            0           2h`;

export const STATEFULSETS = `NAMESPACE   NAME   READY   AGE
default     db     1/1     5d`;

export const DAEMONSETS = `NAMESPACE     NAME         DESIRED   CURRENT   READY   UP-TO-DATE   AVAILABLE   NODE SELECTOR   AGE
kube-system   kube-proxy   3         3         3       3            3           <none>          10d`;

export const PVCS = `NAMESPACE   NAME         STATUS    VOLUME   CAPACITY   ACCESS MODES   STORAGECLASS   AGE
default     data-db-0    Bound     pvc-1    10Gi       RWO            standard       5d
default     cache-pvc    Pending   <none>   5Gi        RWO            standard       1h`;

export const INGRESSES = `NAMESPACE   NAME     CLASS   HOSTS             ADDRESS         PORTS   AGE
default     web-ing  nginx   app.example.com   34.121.55.20    80      3d`;

// ── Tab response payloads (shape matches Flask /api/v1/tab/:id/:tab) ───────

export const TAB_DATA: Record<string, Record<string, string>> = {
  workloads: {
    deployments:  DEPLOYMENTS,
    statefulsets: STATEFULSETS,
    daemonsets:   DAEMONSETS,
    replicasets:  "",
    jobs:         "",
    cronjobs:     "",
  },
  pods:       { pods: PODS },
  nodes:      { output: NODES },
  events:     { output: EVENTS },
  services:   { services: SERVICES },
  ingress:    { ingresses: INGRESSES, ingressclasses: "" },
  k8s_storage:{ pvcs: PVCS, pvs: "", storageclasses: "" },
  network:    { services: SERVICES, ingresses: INGRESSES },
  // ssh overview
  overview: {
    uptime:     " 15:42:01 up 3 days,  2:17,  1 user,  load average: 0.42",
    memory:     "              total        used        free\nMem:        8024000     3012000     5012000",
    disk:       "/dev/sda1        50G    22G    28G  44% /",
    cpu:        "%Cpu(s):  12.4 us,  3.1 sy,  0.0 ni, 82.5 id",
    os:         "PRETTY_NAME=\"Ubuntu 22.04 LTS\"",
    failed_svc: "",
    top_procs:  "  PID  USER      %CPU  %MEM  COMMAND\n 1234 root      12.3   5.4  nginx\n 2345 www-data   8.1   3.2  python",
  },
  // docker
  containers: {
    output: `CONTAINER ID   IMAGE          COMMAND       CREATED       STATUS         PORTS         NAMES
abc123def456   nginx:latest   "nginx"       3 days ago    Up 3 days      80/tcp        web
def456abc789   redis:7        "redis"       2 days ago    Up 2 days      6379/tcp      cache
789abc123def   postgres:15    "postgres"    1 week ago    Exited (0) 1h  5432/tcp      db-old`,
  },
  volumes: {
    output: `DRIVER    VOLUME NAME
local     data-vol
local     cache-vol
local     logs-vol`,
  },
  images: {
    output: `REPOSITORY   TAG       IMAGE ID       CREATED       SIZE
nginx        latest    abc123def456   3 days ago    142MB
redis        7         def456abc789   5 days ago    113MB
postgres     15        789abc123def   1 week ago    379MB`,
  },
  stats: {
    output: `CONTAINER     CPU %    MEM USAGE / LIMIT   MEM %    NET I/O       BLOCK I/O
web           1.20%    45MiB / 2GiB        2.25%    1.2kB/800B    0B/0B
cache         82.50%   120MiB / 2GiB       6.00%    3.4kB/2.1kB   0B/0B
db-old        55.00%   380MiB / 2GiB       19.00%   0B/0B         0B/0B`,
  },
};

// ── helper used by specs to install routes ─────────────────────────────────

import type { Page, Route } from "@playwright/test";

export async function mockApi(page: Page, targetType: TargetType | null) {
  await page.route("**/api/v1/**", (route: Route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;

    if (p === "/api/v1/targets") {
      const body = targetType ? [TARGETS[targetType]] : [];
      return route.fulfill({ json: body });
    }
    if (p === "/api/v1/info") {
      return route.fulfill({ json: { tool_model: "mock", answer_model: "mock" } });
    }
    if (p === "/api/v1/monitor/status") {
      return route.fulfill({ json: { active: false } });
    }
    if (p.startsWith("/api/v1/namespaces/")) {
      return route.fulfill({ json: ["default", "kube-system", "staging"] });
    }
    if (p.startsWith("/api/v1/tab/")) {
      const tab = p.split("/").pop() || "";
      return route.fulfill({ json: TAB_DATA[tab] ?? { output: "" } });
    }
    if (p.startsWith("/api/v1/stats")) {
      return route.fulfill({ json: { counts: {}, top_failing: [], recent: [] } });
    }
    return route.fulfill({ json: {} });
  });
}
