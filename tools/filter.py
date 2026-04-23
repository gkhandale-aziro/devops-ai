"""
tools/filter.py — detect destructive commands before execution.

Used by the human-in-the-loop approval gate in agent/conversation.py.
When this function returns True, the agent pauses and streams an
`await_approval` SSE frame to the UI instead of running the command.
"""
import shlex


# kubectl global flags that consume the next token as their value. These must
# be skipped when hunting for the primary verb, otherwise the verb is mistaken
# for a flag value (or vice versa). Covers the flags the agent actually
# emits in practice plus the common ones operators type by hand.
_KUBECTL_VALUE_FLAGS = frozenset({
    "-n", "--namespace",
    "--context", "--kubeconfig", "--cluster",
    "--user", "--as", "--as-group",
    "--cache-dir", "--request-timeout",
    "-s", "--server", "--tls-server-name",
    "--token", "--client-certificate", "--client-key",
    "--certificate-authority",
    "-v", "--v", "--log-flush-frequency",
})

# Top-level kubectl verbs that mutate cluster state. `rollout` is handled
# separately because only some subverbs are destructive (`restart`, `undo`
# are; `status`, `history` are not).
_KUBECTL_DESTRUCTIVE_VERBS = frozenset({
    "delete", "remove",
    "apply", "create", "patch", "edit", "replace",
    "scale", "set",
    "cordon", "uncordon", "drain", "taint",
    "exec",
    "label", "annotate",
})

_KUBECTL_ROLLOUT_DESTRUCTIVE = frozenset({"restart", "undo"})


def _kubectl_verb(command):
    """Return (verb, subverb) for a kubectl invocation, skipping global flags.

    Returns (None, None) if the command isn't kubectl or can't be tokenized.
    Handles both `--flag=value` and `--flag value` forms, plus short flags
    like `-n demo` and standalone boolean flags like `--all-namespaces`.
    """
    try:
        tokens = shlex.split(command)
    except ValueError:
        return (None, None)

    if not tokens or tokens[0] != "kubectl":
        return (None, None)

    i = 1
    while i < len(tokens):
        tok = tokens[i]
        if tok.startswith("-"):
            if "=" in tok:
                # --flag=value form — single token.
                i += 1
            elif tok in _KUBECTL_VALUE_FLAGS:
                # Two-token flag: skip the value too.
                i += 2
            else:
                # Standalone boolean flag (-A, --all-namespaces, etc.).
                i += 1
            continue
        # First non-flag token is the verb.
        verb = tok
        subverb = tokens[i + 1] if i + 1 < len(tokens) else None
        return (verb, subverb)

    return (None, None)


def is_destructive(command):
    """Return True if command modifies or deletes resources.

    For kubectl invocations, parses out the primary verb so flags between
    `kubectl` and the verb (e.g. `kubectl -n demo set image ...`) don't
    hide destructive operations from the approval gate.

    For non-kubectl commands, uses a conservative substring list covering
    docker / helm / git / shell destructive forms.
    """
    verb, subverb = _kubectl_verb(command)
    if verb is not None:
        if verb in _KUBECTL_DESTRUCTIVE_VERBS:
            return True
        if verb == "rollout" and subverb in _KUBECTL_ROLLOUT_DESTRUCTIVE:
            return True
        # kubectl command with a non-destructive verb — short-circuit so
        # we don't false-positive on argument values like
        # `--field-selector=status=delete-me`.
        return False

    cmd = f" {command} "
    destructive = [
        " delete ", " remove ", " rm ", " drop ", " truncate ",
        " kill ", " destroy ", " reset ", " purge ",
        "docker stop", "docker rm", "docker rmi", "docker kill",
        "helm install", "helm upgrade", "helm uninstall",
        "git push", "git reset", "git rebase",
    ]
    return any(w in cmd for w in destructive)
