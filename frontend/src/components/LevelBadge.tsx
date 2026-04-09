import { LEVEL_LABELS, levelColor } from "../types";

interface Props {
  level: string;
  showLabel?: boolean;
}

export function LevelBadge({ level, showLabel = false }: Props) {
  const c = levelColor(level);
  const label = (LEVEL_LABELS as Record<string, string>)[level];
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
      {level}{showLabel && label ? ` — ${label}` : ""}
    </span>
  );
}
