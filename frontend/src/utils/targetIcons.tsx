/**
 * targetIcons.tsx — shared icon + brand-color mapping for connection types.
 * Single source of truth used by Sidebar, AddTargetModal, and anywhere else
 * that needs to render a recognizable icon for a TargetType.
 *
 * Brand logos come from `react-icons`, which aggregates multiple official
 * icon sets:
 *   - Simple Icons (si):     Kubernetes, Docker, GCP, Terraform
 *   - Font Awesome 6 (fa6):  AWS (Simple Icons removed the AWS mark over
 *                            trademark concerns; Font Awesome still ships it)
 *   - VS Code Icons (vsc):   Azure (Microsoft's own icon set)
 *   - Lucide:                ssh, local (no official brand mark exists)
 */
import type { ComponentType, SVGProps } from "react";
import { SiKubernetes, SiDocker, SiGooglecloud, SiTerraform } from "react-icons/si";
import { FaAws } from "react-icons/fa6";
import { VscAzure } from "react-icons/vsc";
import { SquareTerminal, Laptop } from "lucide-react";
import type { TargetType } from "../types";

/** Icons from react-icons and Lucide both accept size + standard SVG props. */
type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

interface TypeMeta {
  icon:  IconComponent;
  color: string;
  label: string;
}

/** Canonical icon + brand color for every connection type. */
export const TARGET_META: Record<TargetType, TypeMeta> = {
  kubernetes: { icon: SiKubernetes,   color: "#326CE5", label: "Kubernetes"  },
  docker:     { icon: SiDocker,       color: "#2496ED", label: "Docker"      },
  ssh:        { icon: SquareTerminal, color: "#22c55e", label: "Linux / SSH" },
  aws:        { icon: FaAws,          color: "#FF9900", label: "AWS"         },
  gcp:        { icon: SiGooglecloud,  color: "#4285F4", label: "GCP"         },
  azure:      { icon: VscAzure,       color: "#0078D4", label: "Azure"       },
  terraform:  { icon: SiTerraform,    color: "#7B42BC", label: "Terraform"   },
  local:      { icon: Laptop,         color: "#22c55e", label: "Local"       },
};
