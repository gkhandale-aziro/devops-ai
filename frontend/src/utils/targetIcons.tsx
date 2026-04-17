/**
 * targetIcons.tsx — shared Lucide icon + brand-color mapping for connection types.
 * Single source of truth used by Sidebar, AddTargetModal, and anywhere else
 * that needs to render a recognizable icon for a TargetType.
 */
import {
  Ship,
  Container,
  SquareTerminal,
  Cloud,
  CloudCog,
  MonitorCloud,
  Blocks,
  Laptop,
  Hammer,
} from "lucide-react";
import type { TargetType } from "../types";

interface TypeMeta {
  icon:  typeof Ship;
  color: string;
  label: string;
}

/** Canonical icon + brand color for every connection type. */
export const TARGET_META: Record<TargetType, TypeMeta> = {
  kubernetes: { icon: Ship,           color: "#326CE5", label: "Kubernetes" },
  docker:     { icon: Container,      color: "#2496ED", label: "Docker" },
  ssh:        { icon: SquareTerminal, color: "#22c55e", label: "Linux / SSH" },
  aws:        { icon: Cloud,          color: "#FF9900", label: "AWS" },
  gcp:        { icon: CloudCog,       color: "#4285F4", label: "GCP" },
  azure:      { icon: MonitorCloud,   color: "#0078D4", label: "Azure" },
  terraform:  { icon: Blocks,         color: "#7B42BC", label: "Terraform" },
  local:      { icon: Laptop,         color: "#22c55e", label: "Local" },
  jenkins:    { icon: Hammer,         color: "#D33833", label: "Jenkins" },
};
