/**
 * Maps a Kubernetes pod failure reason to the SRE-default `kubectl` command.
 *
 * Used by the Dashboard "Resolve & Verify" action to pre-fill the modal so
 * the operator doesn't type the command from scratch. Operators can still
 * edit before executing; the backend re-validates the verb allowlist.
 *
 * `delete pod` is the default for transient pod failures AND stuck-pending
 * states (ContainerCreating / PodInitializing usually unstick on re-create;
 * for Pending on FailedScheduling, delete won't help — the operator is
 * expected to look at the YAML tab and either edit the command or take a
 * node-level action).
 *
 * Returns "" for reasons that have no safe pod-level default at all.
 */
export function suggestRemediation(reason: string, object: string, namespace: string): string {
  const ns  = namespace || "default";
  const del = `kubectl delete pod ${object} -n ${ns}`;

  switch (reason) {
    case "CrashLoopBackOff":
    case "ImagePullBackOff":
    case "ErrImagePull":
    case "Error":
    case "Evicted":
    case "OOMKilled":
    case "Pending":
    case "ContainerCreating":
    case "PodInitializing":
      return del;
    default:
      return "";
  }
}
