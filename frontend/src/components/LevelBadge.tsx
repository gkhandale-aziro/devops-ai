import { LEVEL_LABELS } from "../types";
import { Badge } from "./ui/badge";

interface Props {
  level: string;
  showLabel?: boolean;
}

const LEVEL_MAP: Record<string, { variant: "destructive" | "warning" | "info"; label: string }> = {
  "SEV1": { variant: "destructive", label: "SEV1" },
  "SEV2": { variant: "warning", label: "SEV2" },
  "SEV3": { variant: "info", label: "SEV3" },
  "1": { variant: "destructive", label: "SEV1" },
  "2": { variant: "warning", label: "SEV2" },
  "3": { variant: "info", label: "SEV3" },
  "L1": { variant: "destructive", label: "SEV1" },
  "L2": { variant: "warning", label: "SEV2" },
  "L3": { variant: "info", label: "SEV3" },
};

export function LevelBadge({ level, showLabel = false }: Props) {
  const mapped = LEVEL_MAP[level] ?? { variant: "info" as const, label: level };
  const desc = (LEVEL_LABELS as Record<string, string>)[mapped.label];
  return (
    <Badge variant={mapped.variant}>
      {mapped.label}{showLabel && desc ? ` — ${desc}` : ""}
    </Badge>
  );
}
