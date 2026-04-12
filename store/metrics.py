"""
store/metrics.py — Background metric collector for Aziro Ops.

Collects system metrics (CPU, memory, disk, load) from targets at regular intervals,
stores them in SQLite via EventStore. Zero-config — parses from commands already
available on every target type (free, df, uptime, kubectl top, docker stats).
"""
import re
import logging
import threading

log = logging.getLogger(__name__)


class MetricCollector:
    """Background collector — runs per-target, parses system metrics, stores in SQLite."""

    INTERVAL = 60  # seconds between collections

    def __init__(self, store):
        self._store = store
        self._threads = {}   # target_id -> threading.Event (stop signal)

    def start(self, target_id: str, target: dict, executor):
        """Start background collection for a target."""
        self.stop(target_id)  # idempotent — stop existing if any

        stop_event = threading.Event()
        self._threads[target_id] = stop_event

        ttype = target.get("type", "ssh")
        parser = self._get_parser(ttype)
        if not parser:
            log.warning("No metric parser for target type %s", ttype)
            return

        def _loop():
            while not stop_event.is_set():
                try:
                    metrics = parser(target, executor)
                    if metrics:
                        self._store.save_metrics(target_id, metrics)
                except Exception:
                    log.exception("Metric collection failed for %s", target_id)
                stop_event.wait(self.INTERVAL)

        t = threading.Thread(target=_loop, daemon=True, name=f"metrics-{target_id}")
        t.start()
        log.info("Started metric collector for %s (%s)", target_id, ttype)

    def stop(self, target_id: str):
        """Stop collection for a target."""
        stop_event = self._threads.pop(target_id, None)
        if stop_event:
            stop_event.set()
            log.info("Stopped metric collector for %s", target_id)

    def stop_all(self):
        """Stop all collectors."""
        for tid in list(self._threads):
            self.stop(tid)

    def _get_parser(self, ttype: str):
        parsers = {
            "ssh":        self._parse_ssh,
            "local":      self._parse_ssh,
            "kubernetes": self._parse_k8s,
            "docker":     self._parse_docker,
        }
        return parsers.get(ttype)

    # -- Parsers ---------------------------------------------------------------

    def _parse_ssh(self, target, executor) -> list:
        """Parse free -m, df -h /, uptime -> mem_pct, disk_pct, load_1m"""
        metrics = []
        try:
            # Memory
            raw = executor("free -m 2>/dev/null")
            m = re.search(r"Mem:\s+(\d+)\s+(\d+)", raw or "")
            if m:
                total, used = int(m.group(1)), int(m.group(2))
                if total > 0:
                    metrics.append({"metric": "mem_pct", "value": round(used / total * 100, 1)})

            # Disk
            raw = executor("df -h / 2>/dev/null | tail -1")
            m = re.search(r"(\d+)%", raw or "")
            if m:
                metrics.append({"metric": "disk_pct", "value": float(m.group(1))})

            # Load average (1 min)
            raw = executor("uptime 2>/dev/null")
            m = re.search(r"load average[s]?:\s*([\d.]+)", raw or "")
            if m:
                metrics.append({"metric": "load_1m", "value": float(m.group(1))})
        except Exception:
            log.debug("SSH metric parse error", exc_info=True)
        return metrics

    def _parse_k8s(self, target, executor) -> list:
        """Parse kubectl top nodes -> cluster-wide avg cpu_pct, mem_pct"""
        metrics = []
        try:
            raw = executor("kubectl top nodes --no-headers 2>/dev/null")
            if not raw:
                return metrics
            cpu_vals, mem_vals = [], []
            for line in raw.strip().splitlines():
                parts = line.split()
                if len(parts) >= 5:
                    # Format: NAME CPU(cores) CPU% MEM(bytes) MEM%
                    cpu_m = re.search(r"(\d+)", parts[2])
                    mem_m = re.search(r"(\d+)", parts[4])
                    if cpu_m:
                        cpu_vals.append(float(cpu_m.group(1)))
                    if mem_m:
                        mem_vals.append(float(mem_m.group(1)))
            if cpu_vals:
                metrics.append({"metric": "cpu_pct", "value": round(sum(cpu_vals) / len(cpu_vals), 1)})
            if mem_vals:
                metrics.append({"metric": "mem_pct", "value": round(sum(mem_vals) / len(mem_vals), 1)})
        except Exception:
            log.debug("K8s metric parse error", exc_info=True)
        return metrics

    def _parse_docker(self, target, executor) -> list:
        """Parse docker stats --no-stream -> aggregate cpu_pct, mem_pct"""
        metrics = []
        try:
            raw = executor("docker stats --no-stream --format '{{.CPUPerc}}\\t{{.MemPerc}}' 2>/dev/null")
            if not raw:
                return metrics
            cpu_vals, mem_vals = [], []
            for line in raw.strip().splitlines():
                parts = line.split("\t")
                if len(parts) >= 2:
                    cpu_m = re.search(r"([\d.]+)", parts[0])
                    mem_m = re.search(r"([\d.]+)", parts[1])
                    if cpu_m:
                        cpu_vals.append(float(cpu_m.group(1)))
                    if mem_m:
                        mem_vals.append(float(mem_m.group(1)))
            if cpu_vals:
                metrics.append({"metric": "cpu_pct", "value": round(sum(cpu_vals), 1)})
            if mem_vals:
                metrics.append({"metric": "mem_pct", "value": round(sum(mem_vals) / len(mem_vals), 1)})
        except Exception:
            log.debug("Docker metric parse error", exc_info=True)
        return metrics
