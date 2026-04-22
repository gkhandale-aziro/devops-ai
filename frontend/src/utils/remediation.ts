/**
 * Maps a Kubernetes pod failure reason to the SRE-default `kubectl` command.
 *
 * Used by the Dashboard "Resolve & Verify" action to pre-fill the modal so
 * the operator doesn't type the command from scratch. Operators can still
 * edit before executing; the backend re-validates the verb allowlist.
 *
 * Returns "" when there is no safe default — e.g. `FailedScheduling` needs
 * node-level investigation, not a blanket delete.
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
      return del;
    default:
      return "";
  }
}
