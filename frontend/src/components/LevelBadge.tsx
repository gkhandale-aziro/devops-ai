import type { TriageLevel } from "../types";
import { LEVEL_LABELS, LEVEL_COLORS } from "../types";

interface Props {
  level: TriageLevel;
  showLabel?: boolean;
}

export function LevelBadge({ level, showLabel = false }: Props) {
  const c = LEVEL_COLORS[level];
  return (
    <span
      style={{
        background:    c.bg,
        color:         c.text,
        border:        `1px solid ${c.border}`,
        borderRadius:  4,
        padding:       "2px 7px",
        fontSize:      11,
        fontWeight:    700,
        whiteSpace:    "nowrap",
      }}
    >
      {level}{showLabel ? ` — ${LEVEL_LABELS[level]}` : ""}
    </span>
  );
}
