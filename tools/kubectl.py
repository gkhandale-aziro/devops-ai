"""
tools/kubectl.py — execute kubectl commands with optional context/kubeconfig.

Supports multiple Kubernetes providers:
  - local       : Docker Desktop, minikube, kind (context + kubeconfig)
  - eks         : AWS EKS (profile, region, cluster)
  - gke         : Google GKE (project, zone/region, cluster)
  - aks         : Azure AKS (resource_group, cluster, subscription)
"""
import os
import shlex
from .base import run_command


def check_cloud_auth(provider, config=None):
    """
    Verify that the cloud CLI is installed and the user is authenticated.
    Returns { "cli_installed": bool, "authenticated": bool, "identity": str, "error": str }.
    """
    config = config or {}

    if provider == "eks":
        # Check AWS CLI exists
        cli_out = run_command("aws --version 2>&1", timeout=10)
        if "aws-cli" not in cli_out.lower():
            return {"cli_installed": False, "authenticated": False, "identity": "",
                    "error": "AWS CLI not found. Install: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html"}
        # Check authentication
        profile = config.get("profile", "")
        profile_flag = f"--profile {profile}" if profile else ""
        auth_out = run_command(f"aws sts get-caller-identity {profile_flag} 2>&1", timeout=15)
        if "arn:" in auth_out:
            return {"cli_installed": True, "authenticated": True, "identity": auth_out.strip(), "error": ""}
        return {"cli_installed": True, "authenticated": False, "identity": "",
                "error": f"Not authenticated. Run: aws configure{' --profile ' + profile if profile else ''}\nOr for SSO: aws sso login{' --profile ' + profile if profile else ''}"}

    if provider == "gke":
        cli_out = run_command("gcloud --version 2>&1", timeout=10)
        if "google cloud" not in cli_out.lower() and "gcloud" not in cli_out.lower():
            return {"cli_installed": False, "authenticated": False, "identity": "",
                    "error": "gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install"}
        auth_out = run_command("gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>&1", timeout=15)
        if "@" in auth_out:
            return {"cli_installed": True, "authenticated": True, "identity": auth_out.strip(), "error": ""}
        return {"cli_installed": True, "authenticated": False, "identity": "",
                "error": "Not authenticated. Run: gcloud auth login"}

    if provider == "aks":
        cli_out = run_command("az --version 2>&1", timeout=10)
        if "azure-cli" not in cli_out.lower():
            return {"cli_installed": False, "authenticated": False, "identity": "",
                    "error": "Azure CLI not found. Install: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli"}
        auth_out = run_command("az account show --query '{name:name, user:user.name}' -o tsv 2>&1", timeout=15)
        if "error" in auth_out.lower() or "please run" in auth_out.lower():
            return {"cli_installed": True, "authenticated": False, "identity": "",
                    "error": "Not authenticated. Run: az login"}
        return {"cli_installed": True, "authenticated": True, "identity": auth_out.strip(), "error": ""}

    if provider == "local":
        cli_out = run_command("kubectl version --client --short 2>&1 || kubectl version --client 2>&1", timeout=10)
        has_kubectl = "client version" in cli_out.lower() or "gitversion" in cli_out.lower()
        if not has_kubectl:
            return {"cli_installed": False, "authenticated": False, "identity": "",
                    "error": "kubectl not found. Install: https://kubernetes.io/docs/tasks/tools/"}
        return {"cli_installed": True, "authenticated": True, "identity": "kubectl available", "error": ""}

    return {"cli_installed": False, "authenticated": False, "identity": "",
            "error": f"Unknown provider: {provider}"}


def setup_kubeconfig(config):
    """
    Run provider-specific kubeconfig setup if needed.
    Returns (success: bool, message: str).
    Respects custom kubeconfig path if configured.
    """
    provider   = config.get("provider", "local")
    kubeconfig = config.get("kubeconfig", "")

    # Prepend KUBECONFIG env var so credentials are written to the custom path.
    # Quote the path to prevent shell injection via malicious kubeconfig values.
    kc_prefix = f"KUBECONFIG={shlex.quote(kubeconfig)} " if kubeconfig else ""

    # All config values are quoted via shlex.quote() below to prevent shell
    # injection. Values originate from user-supplied target configs and flow
    # into shell=True subprocess calls in tools/base.run_command.

    if provider == "eks":
        cluster = config.get("cluster", "")
        region  = config.get("region", "")
        profile = config.get("profile", "")
        if not cluster:
            return False, "EKS cluster name is required"
        cmd = f"aws eks update-kubeconfig --name {shlex.quote(cluster)}"
        if region:
            cmd += f" --region {shlex.quote(region)}"
        if profile:
            cmd += f" --profile {shlex.quote(profile)}"
        if kubeconfig:
            cmd += f" --kubeconfig {shlex.quote(kubeconfig)}"
        out = run_command(cmd)
        return "error" not in out.lower(), out

    if provider == "gke":
        cluster = config.get("cluster", "")
        project = config.get("project", "")
        zone    = config.get("zone", "")
        if not cluster:
            return False, "GKE cluster name is required"
        cmd = f"gcloud container clusters get-credentials {shlex.quote(cluster)}"
        if project:
            cmd += f" --project {shlex.quote(project)}"
        if zone:
            # zone can be a region (us-central1) or zone (us-central1-a)
            flag = "--region" if zone.count("-") == 1 else "--zone"
            cmd += f" {flag} {shlex.quote(zone)}"
        # gcloud respects KUBECONFIG env var for output path
        out = run_command(kc_prefix + cmd)
        return "error" not in out.lower(), out

    if provider == "aks":
        cluster        = config.get("cluster", "")
        resource_group = config.get("resource_group", "")
        subscription   = config.get("subscription", "")
        if not cluster or not resource_group:
            return False, "AKS cluster name and resource group are required"
        cmd = (f"az aks get-credentials --name {shlex.quote(cluster)} "
               f"--resource-group {shlex.quote(resource_group)}")
        if subscription:
            cmd += f" --subscription {shlex.quote(subscription)}"
        if kubeconfig:
            cmd += f" --file {shlex.quote(kubeconfig)}"
        cmd += " --overwrite-existing"
        out = run_command(cmd)
        return "error" not in out.lower(), out

    # local / default — no setup needed
    return True, "ok"


def run_kubernetes(config, command):
    context    = config.get("context", "")
    kubeconfig = config.get("kubeconfig", "")
    env_parts  = []

    # All config values are shlex.quote()d before interpolation — user-supplied
    # config fields would otherwise inject shell commands via run_command(shell=True).

    if kubeconfig:
        env_parts.append(f"KUBECONFIG={shlex.quote(kubeconfig)}")

    # Inject provider-specific env vars
    provider = config.get("provider", "local")
    if provider == "eks":
        profile = config.get("profile", "")
        region  = config.get("region", "")
        if profile:
            env_parts.append(f"AWS_PROFILE={shlex.quote(profile)}")
        if region:
            env_parts.append(f"AWS_DEFAULT_REGION={shlex.quote(region)}")
    elif provider == "gke":
        sa_key = config.get("service_account_key_file", "")
        if sa_key:
            env_parts.append(f"GOOGLE_APPLICATION_CREDENTIALS={shlex.quote(sa_key)}")
    elif provider == "aks":
        tenant = config.get("tenant", "")
        if tenant:
            env_parts.append(f"AZURE_TENANT_ID={shlex.quote(tenant)}")

    prefix = " ".join(env_parts) + " " if env_parts else ""

    if context and "kubectl" in command and "--context" not in command:
        command = command.replace(
            "kubectl ", f"kubectl --context={shlex.quote(context)} ", 1
        )
    return run_command(prefix + command)
