import { describe, it, expect } from "vitest";
import { suggestRemediation } from "./remediation";

describe("suggestRemediation", () => {
  it("suggests delete-pod for CrashLoopBackOff", () => {
    expect(suggestRemediation("CrashLoopBackOff", "web-2", "default"))
      .toBe("kubectl delete pod web-2 -n default");
  });

  it("suggests delete-pod for ImagePullBackOff / ErrImagePull", () => {
    expect(suggestRemediation("ImagePullBackOff", "api-7", "prod"))
      .toBe("kubectl delete pod api-7 -n prod");
    expect(suggestRemediation("ErrImagePull", "api-7", "prod"))
      .toBe("kubectl delete pod api-7 -n prod");
  });

  it("suggests delete-pod for OOMKilled / Evicted / Error", () => {
    for (const r of ["OOMKilled", "Evicted", "Error"]) {
      expect(suggestRemediation(r, "p", "n")).toBe("kubectl delete pod p -n n");
    }
  });

  it("suggests delete-pod for stuck-pending states", () => {
    for (const r of ["Pending", "ContainerCreating", "PodInitializing"]) {
      expect(suggestRemediation(r, "p", "n")).toBe("kubectl delete pod p -n n");
    }
  });

  it("returns empty string for reasons with no safe pod-level default", () => {
    expect(suggestRemediation("FailedScheduling", "p", "n")).toBe("");
    expect(suggestRemediation("Running", "p", "n")).toBe("");
    expect(suggestRemediation("", "p", "n")).toBe("");
  });

  it("defaults empty namespace to 'default'", () => {
    expect(suggestRemediation("CrashLoopBackOff", "p", ""))
      .toBe("kubectl delete pod p -n default");
  });
});
