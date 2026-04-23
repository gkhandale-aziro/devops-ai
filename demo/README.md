# Aziro Demo Sample App

A realistic-looking app deployed to namespace `demo` — covers every Resources tab
(Overview, Kubernetes, Network, Storage, Logs) and includes one intentionally
broken Deployment for the AI to diagnose and fix.

## What's in here

| Resource | Name | Shows up in |
|---|---|---|
| Namespace | `demo` | Overview |
| ConfigMap | `demo-store-config` | Kubernetes → ConfigMaps |
| Secret | `demo-store-creds` | Kubernetes → Secrets |
| PVC | `demo-store-data` (1Gi) | Storage |
| Deployment | `demo-store-web` (2× nginx:1.27-alpine) | Kubernetes → Deployments (healthy) |
| Service | `demo-store-web` (ClusterIP) | Network |
| HPA | `demo-store-web` (CPU 50%, min 2 / max 5) | Kubernetes → HPA |
| Deployment | `demo-store-worker` | Kubernetes → Deployments (**broken**) |

## Deploy

```bash
./deploy.sh
```

## Demo flow

1. Aziro Dashboard → pick the kind target.
2. Resources → Kubernetes → namespace `demo` → worker pod shows red (`ImagePullBackOff`).
3. AI Chat: **"what's wrong in the demo namespace?"**
4. AI runs `kubectl get pods -n demo`, `kubectl describe pod ...`, identifies the bad image tag.
5. AI proposes `kubectl set image deployment/demo-store-worker worker=nginx:1.27-alpine` → **destructive** → approval card appears.
6. Click **Approve**.
7. AI runs `kubectl rollout status deployment/demo-store-worker -n demo` → verifies success.
8. AI re-runs `kubectl get pods -n demo` → worker now `Running`.

That covers **Detect → Diagnose → Fix → Verify** with the approval gate in the middle.

## Re-break (between rehearsals)

```bash
./break.sh    # re-break just the worker (fast, keeps app state)
./reset.sh    # nuke namespace and redeploy from scratch (clean slate)
```

## Port-forward the healthy app (optional)

During the demo, useful to show "this is a real app":

```bash
kubectl -n demo port-forward svc/demo-store-web 8080:80
# then open http://localhost:8080
```

## Why the "fix" isn't `kubectl delete pod`

The pod's spec is wrong (bad image). Deleting the pod makes the ReplicaSet
recreate it from the **same broken spec** → same `ImagePullBackOff`.

The correct fix patches the Deployment spec so a new ReplicaSet rolls out
with a valid image. `kubectl set image` does that atomically.
