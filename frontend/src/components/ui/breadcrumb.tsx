import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { C, SPACE, FONT_SIZE, FONT_WEIGHT } from "../../utils/theme";

export interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: React.ReactNode;
}

/**
 * Navigation breadcrumb trail — last item is the current page (no link).
 * ChevronRight separators between items.
 */
export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: SPACE.sm }}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} style={{ display: "flex", alignItems: "center", gap: SPACE.sm }}>
            {i > 0 && <ChevronRight size={10} stroke={C.text.dim} />}
            {item.icon && (
              <span style={{ display: "flex", alignItems: "center", color: isLast ? "var(--c-accent-hover)" : C.text.faint }}>
                {item.icon}
              </span>
            )}
            {isLast || !item.href ? (
              <span style={{
                fontSize: isLast ? FONT_SIZE.lg : FONT_SIZE.sm,
                fontWeight: isLast ? FONT_WEIGHT.bold : FONT_WEIGHT.medium,
                color: isLast ? C.text.primary : C.text.faint,
              }}>
                {item.label}
              </span>
            ) : (
              <Link
                to={item.href}
                style={{
                  fontSize: FONT_SIZE.sm,
                  fontWeight: FONT_WEIGHT.medium,
                  color: C.text.faint,
                  textDecoration: "none",
                  transition: "color .15s",
                }}
                className="hover-text-accent"
              >
                {item.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
