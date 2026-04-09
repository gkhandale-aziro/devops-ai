/**
 * test/apiMock.ts — shared mock setup for the `api` client and `readSSE`.
 *
 * Usage:
 *   import { mockApi, mockReadSSE } from "../../test/apiMock";
 *   beforeEach(() => { mockApi.resource.mockReset(); ... });
 *
 * The vi.mock calls must live in each test file (Vitest hoists them), but
 * this module exports the mocked references so tests can configure return
 * values and assert calls without duplicating boilerplate.
 */
import { vi } from "vitest";

/** Pre-built mock functions matching the api shape used by tables.tsx. */
export const mockApi = {
  resource:      vi.fn(),
  tab:           vi.fn(),
  analyzeStream: vi.fn(),
};

/** Mock readSSE — by default yields nothing. Override per-test. */
export const mockReadSSE = vi.fn();
