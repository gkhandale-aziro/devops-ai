import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { TARGET_META } from "./targetIcons";
import type { TargetType } from "../types";

const ALL_TYPES: TargetType[] = [
  "kubernetes", "docker", "ssh", "aws", "gcp", "azure", "terraform", "local",
];

describe("TARGET_META", () => {
  it("has an entry for every TargetType", () => {
    for (const t of ALL_TYPES) {
      expect(TARGET_META[t]).toBeDefined();
      expect(TARGET_META[t].label).toBeTruthy();
      expect(TARGET_META[t].color).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("every icon renders without errors", () => {
    // Regression: catches import errors (e.g. SiAmazonwebservices no longer
    // exists in @icons-pack/react-simple-icons). If any icon component is
    // undefined or broken, createElement will throw.
    for (const t of ALL_TYPES) {
      const Icon = TARGET_META[t].icon;
      expect(Icon).toBeDefined();
      const { container } = render(createElement(Icon, { size: 16 }));
      const svg = container.querySelector("svg");
      expect(svg, `${t} icon should render an <svg>`).not.toBeNull();
    }
  });

  it("uses each target type's official brand color", () => {
    // Spot-check the canonical hex values so an accidental overwrite fails tests.
    expect(TARGET_META.kubernetes.color).toBe("#326CE5");
    expect(TARGET_META.docker.color).toBe("#2496ED");
    expect(TARGET_META.aws.color).toBe("#FF9900");
    expect(TARGET_META.gcp.color).toBe("#4285F4");
    expect(TARGET_META.azure.color).toBe("#0078D4");
    expect(TARGET_META.terraform.color).toBe("#7B42BC");
  });
});
