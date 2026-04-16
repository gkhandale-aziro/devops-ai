"""
Tests for sandbox/safe.py — whitelist command filter.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from sandbox.safe import is_safe


class TestSafeCommands:
    def test_kubectl_get(self):
        ok, _ = is_safe("kubectl get pods -A")
        assert ok is True

    def test_kubectl_describe(self):
        ok, _ = is_safe("kubectl describe pod nginx")
        assert ok is True

    def test_kubectl_logs(self):
        ok, _ = is_safe("kubectl logs nginx --tail=50")
        assert ok is True

    def test_kubectl_top(self):
        ok, _ = is_safe("kubectl top pods")
        assert ok is True

    def test_docker_ps(self):
        ok, _ = is_safe("docker ps -a")
        assert ok is True

    def test_docker_images(self):
        ok, _ = is_safe("docker images")
        assert ok is True

    def test_docker_logs(self):
        ok, _ = is_safe("docker logs mycontainer --tail=50")
        assert ok is True

    def test_helm_list(self):
        ok, _ = is_safe("helm list -A")
        assert ok is True

    def test_git_status(self):
        ok, _ = is_safe("git status")
        assert ok is True

    def test_df(self):
        ok, _ = is_safe("df -h")
        assert ok is True

    def test_free(self):
        ok, _ = is_safe("free -m")
        assert ok is True

    def test_ps(self):
        ok, _ = is_safe("ps aux --sort=-%cpu")
        assert ok is True

    def test_journalctl(self):
        ok, _ = is_safe("journalctl -n 100 --no-pager")
        assert ok is True

    def test_curl_blocked(self):
        # Removed from allowlist in security fix ebc27b9 (B4/B5) — curl
        # could reach cloud-metadata endpoints (169.254.169.254) → SSRF.
        ok, reason = is_safe("curl -s http://example.com")
        assert ok is False
        assert reason


class TestBlockedCommands:
    def test_kubectl_delete(self):
        ok, reason = is_safe("kubectl delete pod nginx")
        assert ok is False
        assert "Blocked" in reason

    def test_kubectl_apply(self):
        ok, _ = is_safe("kubectl apply -f deploy.yaml")
        assert ok is False

    def test_kubectl_scale(self):
        ok, _ = is_safe("kubectl scale deployment nginx --replicas=0")
        assert ok is False

    def test_docker_rm(self):
        ok, _ = is_safe("docker rm mycontainer")
        assert ok is False

    def test_docker_stop(self):
        ok, _ = is_safe("docker stop mycontainer")
        assert ok is False

    def test_helm_install(self):
        ok, _ = is_safe("helm install myrelease ./chart")
        assert ok is False

    def test_rm_rf(self):
        ok, _ = is_safe("rm -rf /tmp/test")
        assert ok is False

    def test_sudo(self):
        ok, _ = is_safe("sudo rm -rf /")
        assert ok is False

    def test_git_push(self):
        ok, _ = is_safe("git push origin main")
        assert ok is False

    def test_redirect_to_root(self):
        ok, _ = is_safe("echo bad > /etc/passwd")
        assert ok is False

    def test_case_bypass_attempt(self):
        # Uppercase bypass should be caught
        ok, _ = is_safe("RM -rf /tmp/test")
        assert ok is False

    def test_not_in_whitelist(self):
        ok, reason = is_safe("somecustomscript.sh --flag")
        assert ok is False
        assert "whitelist" in reason
