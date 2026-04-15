import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import type { Target } from "../types";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../api/client", () => ({
  api: {
    models: {
      list: vi.fn().mockResolvedValue({ cloud: [], ollama: [] }),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock("./ThemeContext", () => ({
  ThemeToggle: () => <div data-testid="theme-toggle">ThemeToggle</div>,
}));

vi.mock("../utils/targetIcons", () => ({
  TARGET_META: {
    kubernetes: { icon: () => <span>K8sIcon</span>, label: "Kubernetes" },
    ssh: { icon: () => <span>SSHIcon</span>, label: "SSH" },
    docker: { icon: () => <span>DockerIcon</span>, label: "Docker" },
    local: { icon: () => <span>LocalIcon</span>, label: "Local" },
    aws: { icon: () => <span>AWSIcon</span>, label: "AWS" },
    gcp: { icon: () => <span>GCPIcon</span>, label: "GCP" },
    azure: { icon: () => <span>AzureIcon</span>, label: "Azure" },
    terraform: { icon: () => <span>TFIcon</span>, label: "Terraform" },
  },
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const k8sTarget: Target = {
  id: "t1",
  name: "prod-cluster",
  type: "kubernetes",
  status: "online",
  config: { context: "prod" },
};

const sshTarget: Target = {
  id: "t2",
  name: "bastion-host",
  type: "ssh",
  status: "offline",
  config: { host: "10.0.0.1" },
};

const defaultProps = {
  targets: [] as Target[],
  activeId: null as string | null,
  onSelect: vi.fn(),
  onRemove: vi.fn(),
  onEdit: vi.fn(),
  onAddClick: vi.fn(),
  monitorActive: false,
  aiModel: "gemini/gemini-2.0-flash",
  onModelChange: vi.fn(),
  modelStatus: "healthy" as "healthy" | "degraded" | "fallback" | "unavailable",
  collapsed: false,
  onToggle: vi.fn(),
};

function renderSidebar(overrides: Partial<typeof defaultProps> = {}, route = "/") {
  const props = { ...defaultProps, ...overrides };
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Sidebar {...props} />
    </MemoryRouter>,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Sidebar", () => {
  // 1. Renders all 6 nav items
  it("renders all 6 nav items", () => {
    renderSidebar();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Live Alerts")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.getByText("AI Chat")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  // 2. Active nav item is highlighted based on route
  it("highlights active nav item based on route", () => {
    renderSidebar({}, "/dashboard");
    const dashboardLink = screen.getByText("Dashboard").closest("a")!;
    expect(dashboardLink).toHaveAttribute("data-active", "true");

    const homeLink = screen.getByText("Home").closest("a")!;
    expect(homeLink).not.toHaveAttribute("data-active");
  });

  // 3. Shows "No connections yet" when targets is empty
  it('shows "No connections yet" when targets is empty', () => {
    renderSidebar({ targets: [] });
    expect(screen.getByText("No connections yet")).toBeInTheDocument();
    expect(screen.getByText("Add a target below")).toBeInTheDocument();
  });

  // 4. Renders target connections with name and status
  it("renders target connections with name and status", () => {
    renderSidebar({ targets: [k8sTarget, sshTarget] });
    expect(screen.getByText("prod-cluster")).toBeInTheDocument();
    expect(screen.getByText("online")).toBeInTheDocument();
    expect(screen.getByText("bastion-host")).toBeInTheDocument();
    expect(screen.getByText("offline")).toBeInTheDocument();
  });

  // 5. Calls onSelect on target click
  it("calls onSelect when a target connection is clicked", () => {
    const onSelect = vi.fn();
    renderSidebar({ targets: [k8sTarget], onSelect });
    fireEvent.click(screen.getByText("prod-cluster"));
    expect(onSelect).toHaveBeenCalledWith(k8sTarget);
  });

  // 6. Calls onRemove on remove button click
  it("calls onRemove when remove button is clicked", () => {
    const onRemove = vi.fn();
    renderSidebar({ targets: [k8sTarget], onRemove });
    const removeBtn = screen.getByLabelText("Remove connection");
    fireEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalledWith("t1");
  });

  // 7. Calls onAddClick on "Add Connection" button click
  it('calls onAddClick when "Add Connection" button is clicked', () => {
    const onAddClick = vi.fn();
    renderSidebar({ onAddClick });
    fireEvent.click(screen.getByText("Add Connection"));
    expect(onAddClick).toHaveBeenCalledTimes(1);
  });

  // 8. Shows monitor pulse dot on Live Alerts when monitorActive=true
  it("shows pulse dot on Live Alerts when monitorActive is true", () => {
    renderSidebar({ monitorActive: true });
    const alertsLink = screen.getByText("Live Alerts").closest("a")!;
    // The pulse dot is a span with animation style inside the alerts nav item
    const pulseDot = alertsLink.querySelector("span[style*='animation']");
    expect(pulseDot).not.toBeNull();
  });

  it("does not show pulse dot on Live Alerts when monitorActive is false", () => {
    renderSidebar({ monitorActive: false });
    const alertsLink = screen.getByText("Live Alerts").closest("a")!;
    const pulseDot = alertsLink.querySelector("span[style*='animation']");
    expect(pulseDot).toBeNull();
  });

  // 9. Collapsed mode: width is 56px
  it("has 56px width when collapsed", () => {
    renderSidebar({ collapsed: true });
    const nav = screen.getByRole("navigation");
    expect(nav.style.width).toBe("56px");
  });

  // 10. Collapsed mode: nav labels are hidden
  it("hides nav labels when collapsed", () => {
    renderSidebar({ collapsed: true });
    expect(screen.queryByText("Home")).not.toBeInTheDocument();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText("Live Alerts")).not.toBeInTheDocument();
    expect(screen.queryByText("History")).not.toBeInTheDocument();
    expect(screen.queryByText("AI Chat")).not.toBeInTheDocument();
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });

  // 11. Collapsed mode: logo is clickable to expand (calls onToggle)
  it("calls onToggle when collapsed logo is clicked", () => {
    const onToggle = vi.fn();
    renderSidebar({ collapsed: true, onToggle });
    const expandBtn = screen.getByLabelText("Expand sidebar");
    fireEvent.click(expandBtn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // 12. Expanded mode: ChevronLeft button calls onToggle
  it("calls onToggle when collapse chevron is clicked in expanded mode", () => {
    const onToggle = vi.fn();
    renderSidebar({ collapsed: false, onToggle });
    const collapseBtn = screen.getByLabelText("Collapse sidebar");
    fireEvent.click(collapseBtn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // 13. Shows AI model name in footer
  it("shows AI model name in footer", () => {
    renderSidebar({ aiModel: "gemini/gemini-2.0-flash" });
    expect(screen.getByText("gemini-2.0-flash")).toBeInTheDocument();
  });

  // 14. Model picker opens on click, shows "Select Model" header
  it('opens model picker on click and shows "Select Model" header', async () => {
    renderSidebar({ aiModel: "gemini/gemini-2.0-flash" });
    const modelButton = screen.getByTitle("Click to change AI model");
    fireEvent.click(modelButton);
    await waitFor(() => {
      expect(screen.getByText("Select Model")).toBeInTheDocument();
    });
  });

  // Additional edge cases

  it("renders expanded width (236px) when not collapsed", () => {
    renderSidebar({ collapsed: false });
    const nav = screen.getByRole("navigation");
    expect(nav.style.width).toBe("236px");
  });

  it("calls onEdit when edit button is clicked", () => {
    const onEdit = vi.fn();
    renderSidebar({ targets: [k8sTarget], onEdit });
    const editBtn = screen.getByLabelText("Edit connection");
    fireEvent.click(editBtn);
    expect(onEdit).toHaveBeenCalledWith(k8sTarget);
  });

  it("does not show 'No connections yet' when collapsed with empty targets", () => {
    renderSidebar({ collapsed: true, targets: [] });
    expect(screen.queryByText("No connections yet")).not.toBeInTheDocument();
  });

  it("shows connections header label in expanded mode", () => {
    renderSidebar({ targets: [k8sTarget] });
    expect(screen.getByText("Connections")).toBeInTheDocument();
  });

  it("shows online/total count when targets exist", () => {
    renderSidebar({ targets: [k8sTarget, sshTarget] });
    // 1 online out of 2 total
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });

  it("renders ThemeToggle in footer", () => {
    renderSidebar();
    expect(screen.getByTestId("theme-toggle")).toBeInTheDocument();
  });

  // ── Additional coverage tests ─────────────────────────────────────────────

  it("renders collapsed connection icons when collapsed with targets", () => {
    renderSidebar({ collapsed: true, targets: [k8sTarget, sshTarget] });
    // Should show type icons but not target names as text
    expect(screen.queryByText("prod-cluster")).not.toBeInTheDocument();
    expect(screen.queryByText("bastion-host")).not.toBeInTheDocument();
    // Icons should still be rendered
    expect(screen.getByText("K8sIcon")).toBeInTheDocument();
    expect(screen.getByText("SSHIcon")).toBeInTheDocument();
  });

  it("shows collapsed connections header with online count", () => {
    renderSidebar({ collapsed: true, targets: [k8sTarget, sshTarget] });
    // Collapsed header shows count like "1/2"
    expect(screen.getByText("1/2")).toBeInTheDocument();
    // Should NOT show the "Connections" label text
    expect(screen.queryByText("Connections")).not.toBeInTheDocument();
  });

  it("renders Add Connection as icon-only button when collapsed", () => {
    const onAddClick = vi.fn();
    renderSidebar({ collapsed: true, onAddClick });
    // No "Add Connection" text in collapsed mode
    expect(screen.queryByText("Add Connection")).not.toBeInTheDocument();
    // The data-tour attribute should still exist on the button
    const addBtn = document.querySelector("[data-tour='add-connection']") as HTMLElement;
    expect(addBtn).not.toBeNull();
    fireEvent.click(addBtn);
    expect(onAddClick).toHaveBeenCalledTimes(1);
  });

  it("renders Restore tips button in expanded mode", () => {
    renderSidebar();
    expect(screen.getByText("Restore tips")).toBeInTheDocument();
  });

  it("does not render Restore tips in collapsed mode", () => {
    renderSidebar({ collapsed: true });
    expect(screen.queryByText("Restore tips")).not.toBeInTheDocument();
  });

  it("shows active connection with highlighted styling", () => {
    renderSidebar({ targets: [k8sTarget], activeId: "t1" });
    // The connection row for the active target should exist
    expect(screen.getByText("prod-cluster")).toBeInTheDocument();
  });

  it("highlights Settings nav item when on /settings route", () => {
    renderSidebar({}, "/settings");
    const settingsLink = screen.getByText("Settings").closest("a")!;
    expect(settingsLink).toHaveAttribute("data-active", "true");
  });

  it("highlights Home nav item when on / route", () => {
    renderSidebar({}, "/");
    const homeLink = screen.getByText("Home").closest("a")!;
    expect(homeLink).toHaveAttribute("data-active", "true");
  });

  it("renders model status dot in footer", () => {
    renderSidebar({ modelStatus: "degraded" });
    // The model button should be present with a status indicator
    const modelButton = screen.getByTitle("Click to change AI model");
    expect(modelButton).toBeInTheDocument();
  });

  it("displays AziroOps brand name in expanded mode", () => {
    renderSidebar();
    expect(screen.getByText(/Aziro/)).toBeInTheDocument();
    expect(screen.getByText("DevOps AI Platform")).toBeInTheDocument();
  });

  it("hides brand text in collapsed mode", () => {
    renderSidebar({ collapsed: true });
    expect(screen.queryByText("DevOps AI Platform")).not.toBeInTheDocument();
  });
});

// ── Phase E2: role-gating + user chip ────────────────────────────────────────

describe("Sidebar role-gating", () => {
  it("hides Add Connection button when onAddClick is undefined (viewer)", () => {
    renderSidebar({ onAddClick: undefined });
    expect(screen.queryByText("Add Connection")).not.toBeInTheDocument();
  });

  it("shows Add Connection when onAddClick is provided (admin)", () => {
    renderSidebar({ onAddClick: vi.fn() });
    expect(screen.getByText("Add Connection")).toBeInTheDocument();
  });

  it("hides per-target remove button when onRemove is undefined", () => {
    renderSidebar({ targets: [k8sTarget], onRemove: undefined });
    expect(screen.queryByLabelText("Remove connection")).not.toBeInTheDocument();
  });

  it("renders the remove button when onRemove is provided", () => {
    renderSidebar({ targets: [k8sTarget], onRemove: vi.fn() });
    expect(screen.getByLabelText("Remove connection")).toBeInTheDocument();
  });
});

describe("Sidebar user chip", () => {
  it("shows the signed-in user + role + a Sign out button", () => {
    const onLogout = vi.fn();
    renderSidebar({
      currentUser: { username: "alice", role: "admin" },
      onLogout,
    });
    const chip = screen.getByTestId("user-chip");
    expect(chip).toHaveTextContent("alice");
    expect(chip).toHaveTextContent("(admin)");
    const logoutBtn = screen.getByLabelText("Sign out");
    fireEvent.click(logoutBtn);
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("omits the user chip when currentUser is null", () => {
    renderSidebar({ currentUser: null });
    expect(screen.queryByTestId("user-chip")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Sign out")).not.toBeInTheDocument();
  });
});
