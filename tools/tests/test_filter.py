"""
Tests for tools/filter.py — destructive command detection.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from tools.filter import is_destructive


class TestSafeCommands:
    def test_kubectl_get(self):
        assert is_destructive("kubectl get pods -A") is False

    def test_kubectl_describe(self):
        assert is_destructive("kubectl describe pod nginx") is False

    def test_kubectl_logs(self):
        assert is_destructive("kubectl logs nginx --tail=50") is False

    def test_docker_ps(self):
        assert is_destructive("docker ps -a") is False

    def test_df(self):
        assert is_destructive("df -h") is False

    def test_free(self):
        assert is_destructive("free -m") is False

    def test_helm_list(self):
        assert is_destructive("helm list -A") is False

    def test_git_log(self):
        assert is_destructive("git log --oneline -10") is False

    def test_git_status(self):
        assert is_destructive("git status") is False

    def test_aws_sts(self):
        assert is_destructive("aws sts get-caller-identity") is False


class TestDestructiveCommands:
    def test_kubectl_delete(self):
        assert is_destructive("kubectl delete pod nginx") is True

    def test_kubectl_apply(self):
        assert is_destructive("kubectl apply -f deployment.yaml") is True

    def test_kubectl_scale(self):
        assert is_destructive("kubectl scale deployment nginx --replicas=0") is True

    def test_kubectl_rollout_restart(self):
        assert is_destructive("kubectl rollout restart deployment nginx") is True

    def test_docker_stop(self):
        assert is_destructive("docker stop mycontainer") is True

    def test_docker_rm(self):
        assert is_destructive("docker rm mycontainer") is True

    def test_docker_rmi(self):
        assert is_destructive("docker rmi myimage") is True

    def test_helm_install(self):
        assert is_destructive("helm install myrelease ./chart") is True

    def test_helm_upgrade(self):
        assert is_destructive("helm upgrade myrelease ./chart") is True

    def test_helm_uninstall(self):
        assert is_destructive("helm uninstall myrelease") is True

    def test_git_push(self):
        assert is_destructive("git push origin main") is True

    def test_git_reset(self):
        assert is_destructive("git reset --hard HEAD~1") is True

    def test_rm_command(self):
        assert is_destructive("rm -rf /tmp/test") is True

    def test_drop_table(self):
        assert is_destructive("drop table users") is True

    def test_destroy(self):
        assert is_destructive("terraform destroy") is True

    # Regression: the approval gate missed `kubectl set image` on the first
    # v1.0 demo. The AI picked the correct remediation (patch Deployment spec
    # via `set image`) but filter.py only knew `kubectl scale` / `rollout
    # restart`, so the command ran without prompting. These cover the family
    # of spec-mutating verbs that should all route through the approval card.
    def test_kubectl_set_image(self):
        assert is_destructive(
            "kubectl set image deployment/web nginx=nginx:1.27 -n demo"
        ) is True

    def test_kubectl_set_env(self):
        assert is_destructive("kubectl set env deployment/web FOO=bar") is True

    def test_kubectl_set_resources(self):
        assert is_destructive(
            "kubectl set resources deployment/web --limits=cpu=200m"
        ) is True

    def test_kubectl_replace(self):
        assert is_destructive("kubectl replace -f deployment.yaml") is True

    def test_kubectl_rollout_undo(self):
        assert is_destructive("kubectl rollout undo deployment/web") is True

    def test_kubectl_cordon(self):
        assert is_destructive("kubectl cordon node-01") is True

    def test_kubectl_uncordon(self):
        assert is_destructive("kubectl uncordon node-01") is True

    def test_kubectl_drain(self):
        assert is_destructive(
            "kubectl drain node-01 --ignore-daemonsets"
        ) is True

    def test_kubectl_taint(self):
        assert is_destructive(
            "kubectl taint nodes node-01 key=value:NoSchedule"
        ) is True

    def test_kubectl_exec(self):
        # Arbitrary command execution inside a pod can do anything — gate it.
        assert is_destructive("kubectl exec -it pod/web -- sh") is True
