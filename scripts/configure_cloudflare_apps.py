#!/usr/bin/env python3
"""Configure the known web applications on the Termix Cloudflare Tunnel."""

from __future__ import annotations

import getpass
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


API = "https://api.cloudflare.com/client/v4"
ACCOUNT_ID = "5d0005ad129c80a82af3607530fd3083"
ZONE_ID = "f1be7bcc7c80e5f585d1c5a99ad94b12"
TUNNEL_ID = "e9bf83e6-87cb-4c26-b558-95fc297f1ac7"
TUNNEL_TARGET = f"{TUNNEL_ID}.cfargotunnel.com"
OWNER_EMAIL = "nicolaselias@pm.me"

PRIVATE_APPS = {
    "gym": "gym.ncls.cc",
    "licitacoes": "licitacoes.ncls.cc",
}

PUBLIC_APPS = {
    "termix.ncls.cc",
    "mercado.ncls.cc",
}

INGRESS = [
    {
        "hostname": "termix.ncls.cc",
        "service": "https://127.0.0.1:8443",
        "originRequest": {"noTLSVerify": True},
    },
    {"hostname": "mercado.ncls.cc", "service": "http://127.0.0.1:8081"},
    {"hostname": "gym.ncls.cc", "service": "http://127.0.0.1:18081"},
    {"hostname": "licitacoes.ncls.cc", "service": "http://127.0.0.1:8000"},
    {"service": "http_status:404"},
]


class Cloudflare:
    def __init__(self, token: str) -> None:
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    def request(self, method: str, path: str, body: dict | None = None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(
            API + path, data=data, headers=self.headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as error:
            details = error.read().decode(errors="replace")
            raise RuntimeError(
                f"Cloudflare {method} {path} failed with HTTP {error.code}: {details}"
            ) from error
        if not payload.get("success"):
            raise RuntimeError(f"Cloudflare {method} {path} failed: {payload}")
        return payload


def ensure_dns(client: Cloudflare, hostname: str) -> None:
    query = urllib.parse.urlencode({"name": hostname})
    records = client.request("GET", f"/zones/{ZONE_ID}/dns_records?{query}")["result"]
    desired = {
        "type": "CNAME",
        "name": hostname,
        "content": TUNNEL_TARGET,
        "proxied": True,
        "ttl": 1,
    }
    if not records:
        client.request("POST", f"/zones/{ZONE_ID}/dns_records", desired)
        print(f"created DNS {hostname}")
        return
    if len(records) != 1:
        raise RuntimeError(f"Refusing to modify multiple DNS records for {hostname}")
    record = records[0]
    matches = (
        record["type"] == desired["type"]
        and record["content"] == desired["content"]
        and record["proxied"] is True
    )
    if matches:
        print(f"kept DNS {hostname}")
        return
    client.request("PUT", f"/zones/{ZONE_ID}/dns_records/{record['id']}", desired)
    print(f"updated DNS {hostname}")


def ensure_private_app(
    client: Cloudflare, name: str, hostname: str, apps: list[dict], idp_id: str
) -> None:
    matches = [app for app in apps if app.get("domain") == hostname]
    if len(matches) > 1:
        raise RuntimeError(f"Refusing to modify duplicate Access apps for {hostname}")
    desired = {
        "name": name,
        "type": "self_hosted",
        "domain": hostname,
        "session_duration": "720h",
        "allowed_idps": [idp_id],
        "auto_redirect_to_identity": False,
        "http_only_cookie_attribute": True,
        "options_preflight_bypass": False,
        "app_launcher_visible": True,
    }
    if matches:
        app = matches[0]
        print(f"kept Access app {hostname}")
    else:
        app = client.request(
            "POST", f"/accounts/{ACCOUNT_ID}/access/apps", desired
        )["result"]
        print(f"created Access app {hostname}")

    policies = client.request(
        "GET", f"/accounts/{ACCOUNT_ID}/access/apps/{app['id']}/policies"
    )["result"]
    owner_policies = [policy for policy in policies if policy.get("name") == "owner-only"]
    policy_body = {
        "name": "owner-only",
        "decision": "allow",
        "precedence": 1,
        "include": [{"email": {"email": OWNER_EMAIL}}],
        "exclude": [],
        "require": [],
    }
    if not owner_policies:
        client.request(
            "POST",
            f"/accounts/{ACCOUNT_ID}/access/apps/{app['id']}/policies",
            policy_body,
        )
        print(f"created owner-only policy {hostname}")
    elif len(owner_policies) == 1:
        policy = owner_policies[0]
        exact = (
            policy.get("decision") == "allow"
            and policy.get("precedence") == 1
            and policy.get("include") == policy_body["include"]
            and not policy.get("exclude")
            and not policy.get("require")
        )
        if exact:
            print(f"kept owner-only policy {hostname}")
        else:
            client.request(
                "PUT",
                f"/accounts/{ACCOUNT_ID}/access/apps/{app['id']}/policies/{policy['id']}",
                policy_body,
            )
            print(f"updated owner-only policy {hostname}")
    else:
        raise RuntimeError(f"Refusing to modify duplicate owner-only policies for {hostname}")


def ensure_public_app(client: Cloudflare, hostname: str, apps: list[dict]) -> None:
    matches = [app for app in apps if app.get("domain") == hostname]
    if len(matches) > 1:
        raise RuntimeError(f"Refusing to remove duplicate Access apps for {hostname}")
    if not matches:
        print(f"kept public hostname {hostname}")
        return
    client.request(
        "DELETE", f"/accounts/{ACCOUNT_ID}/access/apps/{matches[0]['id']}"
    )
    print(f"removed Access app {hostname}")


def main() -> int:
    token = os.environ.get("CLOUDFLARE_API_TOKEN") or getpass.getpass(
        "Cloudflare API token: "
    )
    if not token:
        raise RuntimeError("Cloudflare API token is required")
    client = Cloudflare(token)
    verification = client.request("GET", "/user/tokens/verify")["result"]
    if verification.get("status") != "active":
        raise RuntimeError("Cloudflare API token is not active")

    apps = client.request("GET", f"/accounts/{ACCOUNT_ID}/access/apps")["result"]
    idp_candidates = {
        idp
        for app in apps
        if app.get("domain") in set(PRIVATE_APPS.values()) | PUBLIC_APPS
        for idp in app.get("allowed_idps", [])
    }
    if len(idp_candidates) != 1:
        raise RuntimeError("Unable to identify one verified One-Time PIN provider")
    idp_id = idp_candidates.pop()

    for hostname in sorted(PUBLIC_APPS):
        ensure_public_app(client, hostname, apps)

    config_path = f"/accounts/{ACCOUNT_ID}/cfd_tunnel/{TUNNEL_ID}/configurations"
    client.request(
        "PUT",
        config_path,
        {"config": {"ingress": INGRESS, "warp-routing": {"enabled": False}}},
    )
    print("updated tunnel ingress")

    for hostname in [
        "termix.ncls.cc",
        "mercado.ncls.cc",
        "gym.ncls.cc",
        "licitacoes.ncls.cc",
    ]:
        ensure_dns(client, hostname)
    for name, hostname in PRIVATE_APPS.items():
        ensure_private_app(client, name, hostname, apps, idp_id)
    print("Cloudflare configuration complete")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, urllib.error.URLError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)
