import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AddTargetModal } from "./AddTargetModal";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../api/client", () => ({
  api: {
    targets: { testConnection: vi.fn().mockResolvedValue({ ok: true, message: "Connected" }) },
    cloud: { check: vi.fn().mockResolvedValue({ cli_installed: true, authenticated: true, identity: "test-user" }) },
  },
}));

vi.mock("../utils/targetIcons", () => ({
  TARGET_META: {
    ssh:        { icon: () => <span>SSHIcon</span>,   label: "SSH" },
    kubernetes: { icon: () => <span>K8sIcon</span>,   label: "Kubernetes" },
    docker:     { icon: () => <span>DockerIcon</span>, label: "Docker" },
    aws:        { icon: () => <span>AWSIcon</span>,    label: "AWS" },
    gcp:        { icon: () => <span>GCPIcon</span>,    label: "GCP" },
    azure:      { icon: () => <span>AzureIcon</span>,  label: "Azure" },
    terraform:  { icon: () => <span>TFIcon</span>,     label: "Terraform" },
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const defaultProps = {
  onClose: vi.fn(),
  onAdd: vi.fn().mockResolvedValue(undefined),
};

function renderModal(overrides: Partial<typeof defaultProps & { editTarget?: any; onUpdate?: any }> = {}) {
  return render(<AddTargetModal {...defaultProps} {...overrides} />);
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AddTargetModal", () => {
  // 1. Renders type selection step initially
  it("renders type selection step initially", () => {
    renderModal();
    expect(screen.getByText("Add Connection")).toBeInTheDocument();
  });

  // 2. Shows all 7 target type cards
  it("shows all 7 target type cards", () => {
    renderModal();
    expect(screen.getByText("Linux / SSH")).toBeInTheDocument();
    expect(screen.getByText("Kubernetes")).toBeInTheDocument();
    expect(screen.getByText("Docker")).toBeInTheDocument();
    expect(screen.getByText("AWS")).toBeInTheDocument();
    expect(screen.getByText("GCP")).toBeInTheDocument();
    expect(screen.getByText("Azure")).toBeInTheDocument();
    expect(screen.getByText("Terraform")).toBeInTheDocument();
  });

  // 3. Clicking SSH type goes to details step
  it("clicking SSH type goes to details step", () => {
    renderModal();
    fireEvent.click(screen.getByText("Linux / SSH"));
    // Should now show "Connect to ssh" title and the Name field
    expect(screen.getByText("Connect to ssh")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  // 4. Clicking Kubernetes shows provider sub-step
  it("clicking Kubernetes shows provider sub-step", () => {
    renderModal();
    fireEvent.click(screen.getByText("Kubernetes"));
    expect(screen.getByText("Kubernetes Provider")).toBeInTheDocument();
    expect(screen.getByText("How is your Kubernetes cluster hosted?")).toBeInTheDocument();
    expect(screen.getByText("Local / kubeconfig")).toBeInTheDocument();
    expect(screen.getByText("AWS EKS")).toBeInTheDocument();
    expect(screen.getByText("Google GKE")).toBeInTheDocument();
    expect(screen.getByText("Azure AKS")).toBeInTheDocument();
  });

  // 5. Clicking local provider goes to details step
  it("clicking local provider goes to details step", () => {
    renderModal();
    fireEvent.click(screen.getByText("Kubernetes"));
    fireEvent.click(screen.getByText("Local / kubeconfig"));
    // Should now be on the details step with K8s local fields
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Context")).toBeInTheDocument();
  });

  // 6. Close button calls onClose
  it("close button calls onClose", () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 7. Edit mode skips to details step
  it("edit mode skips to details step", () => {
    const editTarget = {
      id: "t1",
      name: "my-server",
      type: "ssh" as const,
      config: { host: "10.0.0.1", port: "22", user: "ubuntu" },
    };
    renderModal({ editTarget, onUpdate: vi.fn() });
    // Should skip type selection and go straight to details
    expect(screen.queryByText("Add Connection")).not.toBeInTheDocument();
    expect(screen.getByText(/Edit/)).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    // Name should be pre-filled
    expect(screen.getByLabelText("Name")).toHaveValue("my-server");
  });

  // 8. Name input field present on details step
  it("shows name input field on details step", () => {
    renderModal();
    fireEvent.click(screen.getByText("Docker"));
    const nameInput = screen.getByLabelText("Name");
    expect(nameInput).toBeInTheDocument();
    // Can type into it
    fireEvent.change(nameInput, { target: { value: "my-docker" } });
    expect(nameInput).toHaveValue("my-docker");
  });

  // 9. Shows overlay/backdrop
  it("renders overlay backdrop", () => {
    renderModal();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  // 10. Clicking overlay backdrop calls onClose
  it("clicking overlay backdrop calls onClose", () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    // The overlay is the parent div of the dialog
    const dialog = screen.getByRole("dialog");
    const overlay = dialog.parentElement!;
    // Click on the overlay itself (not on the dialog box)
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
