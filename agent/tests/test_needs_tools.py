"""
Tests for agent/needs_tools.py — greeting vs infra heuristic.
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from agent.needs_tools import needs_tools


class TestGreetings:
    def test_hi(self):
        assert needs_tools("hi") is False

    def test_hello(self):
        assert needs_tools("hello") is False

    def test_hey(self):
        assert needs_tools("hey") is False

    def test_thanks(self):
        assert needs_tools("thanks") is False

    def test_thank_you(self):
        assert needs_tools("thank you") is False

    def test_ok(self):
        assert needs_tools("ok") is False

    def test_bye(self):
        assert needs_tools("bye") is False

    def test_good_morning(self):
        assert needs_tools("good morning") is False


class TestGeneralQuestions:
    def test_what_is_kubernetes(self):
        assert needs_tools("what is kubernetes") is False

    def test_explain_docker(self):
        assert needs_tools("explain docker") is False

    def test_how_does_helm_work(self):
        # "helm" is an infra keyword so this correctly triggers tool use
        assert needs_tools("how does helm work") is True

    def test_can_you_help(self):
        assert needs_tools("can you help me") is False

    def test_should_i_use_helm(self):
        # "helm" is an infra keyword so this correctly triggers tool use
        assert needs_tools("should i use helm or kustomize") is True


class TestInfraQuestions:
    def test_check_pods(self):
        assert needs_tools("check pods") is True

    def test_show_disk(self):
        assert needs_tools("show disk usage") is True

    def test_memory_usage(self):
        assert needs_tools("how much memory is left") is True

    def test_cpu_high(self):
        assert needs_tools("why is cpu high") is True

    def test_pod_crashing(self):
        assert needs_tools("why is my pod crashing") is True

    def test_kubectl(self):
        assert needs_tools("kubectl get pods") is True

    def test_docker_containers(self):
        assert needs_tools("list docker containers") is True

    def test_node_status(self):
        assert needs_tools("what is the node status") is True

    def test_logs(self):
        assert needs_tools("show me the logs") is True

    def test_service_down(self):
        assert needs_tools("is the service down") is True

    def test_uptime(self):
        assert needs_tools("check uptime") is True

    def test_storage(self):
        assert needs_tools("show storage usage") is True

    def test_network(self):
        assert needs_tools("check network ports") is True

    def test_deploy(self):
        assert needs_tools("show all deployments") is True

    def test_error_in_logs(self):
        assert needs_tools("are there errors in logs") is True
