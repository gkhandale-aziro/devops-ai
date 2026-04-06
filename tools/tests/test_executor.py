"""
Tests for tools/executor.py — ToolExecutor routing by target type.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from unittest.mock import patch
from tools.executor import ToolExecutor


class TestToolExecutor:
    def setup_method(self):
        self.ex = ToolExecutor()

    def _target(self, ttype, config=None):
        return {"type": ttype, "config": config or {}}

    def test_unknown_type_returns_error(self):
        result = self.ex.execute(self._target("foobar"), "echo hi")
        assert "ERROR" in result

    def test_unknown_type_includes_type_name(self):
        result = self.ex.execute(self._target("alien"), "ls")
        assert "alien" in result

    def test_local_runs_echo(self):
        result = self.ex.execute(self._target("local"), "echo localtest")
        assert "localtest" in result

    def test_missing_type_key_defaults_to_error(self):
        # target with no type key
        result = self.ex.execute({}, "echo hi")
        assert "ERROR" in result

    def test_kubernetes_injects_context(self):
        with patch("tools.kubectl.run_command") as mock_run:
            mock_run.return_value = "ok"
            self.ex.execute(
                self._target("kubernetes", {"context": "my-context"}),
                "kubectl get pods"
            )
            called_cmd = mock_run.call_args[0][0]
            assert "--context=my-context" in called_cmd

    def test_kubernetes_no_context(self):
        with patch("tools.kubectl.run_command") as mock_run:
            mock_run.return_value = "ok"
            self.ex.execute(self._target("kubernetes", {}), "kubectl get pods")
            called_cmd = mock_run.call_args[0][0]
            assert "--context" not in called_cmd

    def test_docker_injects_host(self):
        with patch("tools.docker.run_command") as mock_run:
            mock_run.return_value = "ok"
            self.ex.execute(
                self._target("docker", {"host": "tcp://1.2.3.4:2375"}),
                "docker ps"
            )
            called_cmd = mock_run.call_args[0][0]
            assert "DOCKER_HOST=tcp://1.2.3.4:2375" in called_cmd

    def test_aws_injects_profile_and_region(self):
        with patch("tools.aws.run_command") as mock_run:
            mock_run.return_value = "ok"
            self.ex.execute(
                self._target("aws", {"profile": "prod", "region": "us-east-1"}),
                "aws s3 ls"
            )
            called_cmd = mock_run.call_args[0][0]
            assert "AWS_PROFILE=prod" in called_cmd
            assert "AWS_DEFAULT_REGION=us-east-1" in called_cmd

    def test_gcp_injects_project(self):
        with patch("tools.gcp.run_command") as mock_run:
            mock_run.return_value = "ok"
            self.ex.execute(
                self._target("gcp", {"project": "my-project"}),
                "gcloud compute instances list"
            )
            called_cmd = mock_run.call_args[0][0]
            assert "--project=my-project" in called_cmd

    def test_azure_injects_subscription(self):
        with patch("tools.azure.run_command") as mock_run:
            mock_run.return_value = "ok"
            self.ex.execute(
                self._target("azure", {"subscription": "my-sub"}),
                "az vm list"
            )
            called_cmd = mock_run.call_args[0][0]
            assert "--subscription my-sub" in called_cmd

    def test_ssh_type_routes_correctly(self):
        from unittest.mock import MagicMock
        mock_run = MagicMock(return_value="ok")
        self.ex._executors["ssh"] = mock_run
        self.ex.execute(self._target("ssh", {"host": "1.2.3.4"}), "uptime")
        assert mock_run.called
