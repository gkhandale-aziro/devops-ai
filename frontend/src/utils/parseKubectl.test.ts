import { describe, it, expect } from "vitest";
import { parseKubectl } from "./parseKubectl";

const PODS_OUTPUT = `NAME                        READY   STATUS    RESTARTS   AGE
frontend-7d9f6c8b5-xk2jp    1/1     Running   0          2d
backend-api-5c4b9f7d-lm3kz  1/1     Running   3          5d
db-primary-0                0/1     Pending   0          1h`;

describe("parseKubectl", () => {
  it("returns empty headers and rows for empty input", () => {
    expect(parseKubectl("")).toEqual({ headers: [], rows: [] });
    expect(parseKubectl("   \n  ")).toEqual({ headers: [], rows: [] });
  });

  it("title-cases headers and replaces hyphens with spaces", () => {
    const { headers } = parseKubectl(PODS_OUTPUT);
    expect(headers).toEqual(["Name", "Ready", "Status", "Restarts", "Age"]);
  });

  it("parses RESTART-AGE style hyphenated headers correctly", () => {
    const raw = `LAST-SCHEDULE  COMPLETIONS  DURATION
5m             1/1          30s`;
    const { headers } = parseKubectl(raw);
    expect(headers).toEqual(["Last Schedule", "Completions", "Duration"]);
  });

  it("splits rows by 2+ spaces", () => {
    const { rows } = parseKubectl(PODS_OUTPUT);
    expect(rows).toHaveLength(3);
    expect(rows[0][0]).toBe("frontend-7d9f6c8b5-xk2jp");
    expect(rows[0][2]).toBe("Running");
  });

  it("returns only headers when there are no data rows", () => {
    const raw = `NAME  READY  STATUS`;
    const { headers, rows } = parseKubectl(raw);
    expect(headers).toHaveLength(3);
    expect(rows).toHaveLength(0);
  });

  it("handles null/undefined gracefully", () => {
    // @ts-expect-error — testing runtime safety
    expect(parseKubectl(null)).toEqual({ headers: [], rows: [] });
  });
});
