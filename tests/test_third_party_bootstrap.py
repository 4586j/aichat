import concurrent.futures
import json
import os
from pathlib import Path
import socket
import statistics
import subprocess
import tempfile
import threading
import time
import urllib.request

import pytest

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "test-reports" / "third-party-bootstrap-2026-11-01.json"


def percentile(values, fraction):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round((len(ordered) - 1) * fraction))]


def request(url):
    started = time.perf_counter()
    with urllib.request.urlopen(url, timeout=15) as response:
        payload = json.load(response) if response.headers.get_content_type() == "application/json" else response.read()
        assert response.status == 200
    return time.perf_counter() - started, payload


@pytest.fixture
def app_url():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix="qiyi-third-party-") as data_dir:
        env = os.environ.copy()
        env.update({"PORT": str(port), "AGENT_DATA_DIR": data_dir, "MEDIA_SSH_ENABLED": "false"})
        process = subprocess.Popen(
            ["node", "server.mjs"],
            cwd=ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        url = f"http://127.0.0.1:{port}"
        try:
            deadline = time.monotonic() + 20
            while True:
                if process.poll() is not None:
                    stdout, stderr = process.communicate()
                    raise RuntimeError(f"server exited: {stdout}\n{stderr}")
                try:
                    _, payload = request(f"{url}/api/bootstrap")
                    if isinstance(payload, dict) and "personas" in payload:
                        break
                except (OSError, ValueError):
                    pass
                if time.monotonic() >= deadline:
                    raise RuntimeError("server did not become ready")
                time.sleep(0.05)
            yield url
        finally:
            process.terminate()
            try:
                process.communicate(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate(timeout=5)


def test_bootstrap_stays_responsive_during_concurrent_requests(app_url):
    for _ in range(3):
        request(f"{app_url}/api/bootstrap")

    heartbeat_times = []
    heartbeat_stop = threading.Event()

    def heartbeat():
        while not heartbeat_stop.is_set():
            elapsed, _ = request(f"{app_url}/")
            heartbeat_times.append(elapsed * 1000)
            heartbeat_stop.wait(0.2)

    with concurrent.futures.ThreadPoolExecutor(max_workers=11) as pool:
        active_heartbeat = pool.submit(heartbeat)
        futures = [pool.submit(request, f"{app_url}/api/bootstrap") for _ in range(10)]
        results = [future.result(timeout=20) for future in futures]
        heartbeat_stop.set()
        active_heartbeat.result(timeout=20)

    latencies = [elapsed * 1000 for elapsed, _ in results]
    for _, payload in results:
        assert isinstance(payload["personas"], list)
        assert isinstance(payload["conversations"], list)
        assert isinstance(payload["memories"], list)
        assert payload["stats"]["messageCount"] == 0
    assert heartbeat_times

    report = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "requests": len(latencies),
        "bootstrapMs": {
            "mean": statistics.mean(latencies),
            "p50": percentile(latencies, 0.50),
            "p95": percentile(latencies, 0.95),
            "p99": percentile(latencies, 0.99),
            "max": max(latencies),
        },
        "staticHeartbeatMs": {
            "samples": len(heartbeat_times),
            "mean": statistics.mean(heartbeat_times),
            "max": max(heartbeat_times),
        },
        "scope": "Current implementation only; model key is read once during service construction, not by bootstrap.",
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
