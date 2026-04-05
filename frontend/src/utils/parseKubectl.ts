/**
 * Parses kubectl column-aligned output into headers + rows.
 * Columns are separated by 2+ spaces.
 * Headers are title-cased with hyphens replaced by spaces.
 */
export function parseKubectl(raw: string): { headers: string[]; rows: string[][] } {
  const lines = (raw ?? "").trim().split("\n").filter(Boolean);
  if (lines.length < 1) return { headers: [], rows: [] };
  const headers = lines[0].trim().split(/\s{2,}/).map(h =>
    h.replace(/-/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
  );
  const rows = lines.slice(1).map(l => l.trim().split(/\s{2,}/));
  return { headers, rows };
}
