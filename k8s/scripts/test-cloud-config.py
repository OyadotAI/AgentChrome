#!/usr/bin/env python3
"""Validate cloud wiring in rendered deployments (requires kubectl and PyYAML)."""
from pathlib import Path
import subprocess
import yaml

ROOT = Path(__file__).resolve().parents[2]
for environment, host in [
    ("dev", "dev-browser.getoya.ai"),
    ("prod", "browser.getoya.ai"),
]:
    rendered = subprocess.check_output(
        ["kubectl", "kustomize", str(ROOT / "k8s/overlays" / environment)], text=True
    )
    server = next(doc for doc in yaml.safe_load_all(rendered)
                  if doc.get("kind") == "Deployment" and doc["metadata"]["name"] == "server")
    container = next(c for c in server["spec"]["template"]["spec"]["containers"] if c["name"] == "server")
    env = {item["name"]: item.get("value") for item in container["env"]}
    assert env.get("OYA_PUBLIC_WS_URL") == f"wss://{host}/ws", f"{environment}: missing public callback"
    assert any(item.get("secretRef", {}).get("name") == "app-secrets" for item in container["envFrom"])

    workflow = yaml.safe_load((ROOT / f".github/workflows/deploy-{environment}.yaml").read_text())
    step = next(s for s in workflow["jobs"]["deploy"]["steps"] if s.get("name") == "Apply secrets")
    for name in ["DAYTONA_API_KEY", "DAYTONA_SNAPSHOT", "DAYTONA_API_URL", "DAYTONA_TARGET"]:
        assert step.get("env", {}).get(name) == "${{ secrets." + name + " }}", f"{environment}: {name} not sourced"
        assert f'--from-literal={name}="${{{name}' in step["run"], f"{environment}: {name} not passed to pod secret"
    for name in ["DAYTONA_API_KEY", "DAYTONA_SNAPSHOT"]:
        assert '${' + name + ':?' in step["run"], f"{environment}: missing {name} must fail deployment"
    print(f"PASS {environment}: public callback and cloud secrets reach server")
