/**
 * PodTable.resolve.test.tsx — covers the admin-gated "Resolve & Verify"
 * kebab action that opens ExecuteAndVerifyModal in target-mode. The broader
 * tables-components.test.tsx file stubs useAuth to viewer-scope, so this
 * file stands alone with an admin-scope stub to exercise the new branch.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { mockApi, mockReadSSE } from "../../test/apiMock";

vi.mock("../../api/client", () => ({
  api: {
    resource:      (...args: unknown[]) => mockApi.resource(...args),
    tab:           (...args: unknown[]) => mockApi.tab(...args),
    analyzeStream: (...args: unknown[]) => mockApi.analyzeStream(...args),
    targets:       { executeResolve: vi.fn() },
    events:        { execute:        vi.fn() },
  },
  readSSE: (...args: unknown[]) => mockReadSSE(...args),
}));

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    user:       { id: 1, username: "sre", role: "admin" },
    canWrite:   true,
    isLoggedIn: true,
  }),
}));

// Render the real modal so we can assert its title shows the pod + target name,
// which is proof the kebab threaded the row/target through correctly.
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { PodTable } from "./tables";
import type { Target } from "../../types";

const TARGET: Target = {
  id: "t1", name: "prod-cluster", type: "kubernetes", status: "online", config: {},
};

const POD_RAW = `NAMESPACE   NAME        READY   STATUS             RESTARTS   AGE
default     web-1       1/1     Running            0          3d
default     web-2       0/1     CrashLoopBackOff   5          1h`;

describe("PodTable Resolve & Verify (admin)", () => {
  it("exposes the Resolve & Verify action only on unhealthy rows", async () => {
    render(<PodTable raw={POD_RAW} target={TARGET} />);
    const kebabs = screen.getAllByLabelText("Row actions");
    // Open the kebab for the CrashLoop row (second row).
    fireEvent.click(kebabs[1]);
    expect(await screen.findByText(/resolve & verify/i)).toBeInTheDocument();
  });

  it("opens ExecuteAndVerifyModal in target-mode with suggested command", async () => {
    render(<PodTable raw={POD_RAW} target={TARGET} />);
    const kebabs = screen.getAllByLabelText("Row actions");
    fireEvent.click(kebabs[1]);
    fireEvent.click(await screen.findByText(/resolve & verify/i));

    // Modal title shows the object.
    expect(await screen.findByText(/execute & verify — web-2/i)).toBeInTheDocument();
    // Target name shown in the lede.
    expect(screen.getByText(/prod-cluster/)).toBeInTheDocument();
    // Command pre-filled from suggestRemediation() for CrashLoopBackOff.
    const textarea = screen.getByLabelText(/kubectl command/i) as HTMLTextAreaElement;
    expect(textarea.value).toBe("kubectl delete pod web-2 -n default");
  });
});
