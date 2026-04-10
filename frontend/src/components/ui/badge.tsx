import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "bg-accent/15 text-accent border border-accent/20",
        destructive: "bg-destructive/15 text-destructive border border-destructive/20",
        warning: "bg-warning/15 text-warning border border-warning/20",
        success: "bg-success/15 text-success border border-success/20",
        info: "bg-[#06b6d4]/15 text-[#06b6d4] border border-[#06b6d4]/20",
        outline: "border border-border text-foreground",
        secondary: "bg-raised text-secondary-foreground border border-border",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
