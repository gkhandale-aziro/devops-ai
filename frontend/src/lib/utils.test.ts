import { cn } from "./utils";

describe("cn", () => {
  it("merges classes", () => {
    expect(cn("p-4", "text-sm")).toBe("p-4 text-sm");
  });
  it("resolves Tailwind conflicts (last wins)", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
  });
  it("handles conditional classes", () => {
    expect(cn("flex", false && "hidden", "gap-2")).toBe("flex gap-2");
  });
  it("handles falsy values", () => {
    expect(cn(undefined, null, "flex")).toBe("flex");
  });
});
