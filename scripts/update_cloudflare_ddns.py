#!/usr/bin/env python3
"""Keep the TeamSpeak DNS-only record aligned with the public IPv4 address."""

from __future__ import annotations

import argparse
import ipaddress
import json
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


API_BASE = "https://api.cloudflare.com/client/v4"
TRACE_URL = "https://1.1.1.1/cdn-cgi/trace"
DEFAULT_HOSTNAME = "familiasacana.ncls.cc"
DEFAULT_TOKEN_FILE = Path.home() / ".config/cloudflare/ddns.token"
DEFAULT_ZONE_ID = "f1be7bcc7c80e5f585d1c5a99ad94b12"


class CloudflareError(RuntimeError):
    """Raised when Cloudflare rejects or cannot complete an API request."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hostname", default=DEFAULT_HOSTNAME)
    parser.add_argument("--token-file", type=Path, default=DEFAULT_TOKEN_FILE)
    parser.add_argument("--zone-id", default=DEFAULT_ZONE_ID)
    return parser.parse_args()


def read_token(path: Path) -> str:
    try:
        file_mode = stat.S_IMODE(path.stat().st_mode)
        token = path.read_text(encoding="utf-8").strip()
    except OSError as error:
        raise CloudflareError(f"Unable to read API token file: {path}") from error

    if file_mode & 0o077:
        raise CloudflareError(f"API token file must use mode 0600: {path}")
    if not token:
        raise CloudflareError(f"API token file is empty: {path}")
    return token


def request_json(
    method: str,
    path: str,
    token: str,
    body: dict[str, Any] | None = None,
) -> Any:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        f"{API_BASE}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "Termix-Cloudflare-DDNS/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        details = error.read().decode("utf-8", errors="replace")
        raise CloudflareError(
            f"Cloudflare API returned HTTP {error.code}: {details}"
        ) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise CloudflareError(f"Cloudflare API request failed: {error}") from error

    if not payload.get("success"):
        raise CloudflareError(f"Cloudflare API rejected the request: {payload}")
    return payload.get("result")


def discover_public_ipv4() -> str:
    request = urllib.request.Request(
        TRACE_URL,
        headers={"User-Agent": "Termix-Cloudflare-DDNS/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            trace = response.read().decode("utf-8")
    except (urllib.error.URLError, TimeoutError) as error:
        raise CloudflareError(
            f"Unable to discover public IPv4 address: {error}"
        ) from error

    values = dict(
        line.split("=", 1) for line in trace.splitlines() if "=" in line
    )
    try:
        return str(ipaddress.IPv4Address(values["ip"]))
    except (KeyError, ipaddress.AddressValueError) as error:
        raise CloudflareError(
            "Cloudflare trace did not return a valid IPv4 address"
        ) from error


def ensure_dns_record(token: str, zone_id: str, hostname: str, address: str) -> str:
    query = urllib.parse.urlencode(
        {"type": "A", "name": hostname, "per_page": 100}
    )
    records = request_json(
        "GET", f"/zones/{zone_id}/dns_records?{query}", token
    )
    if not isinstance(records, list):
        raise CloudflareError("Cloudflare returned an invalid DNS record list")
    if len(records) > 1:
        raise CloudflareError(f"Refusing to modify duplicate A records for {hostname}")

    desired = {
        "type": "A",
        "name": hostname,
        "content": address,
        "ttl": 120,
        "proxied": False,
        "comment": "Termix TeamSpeak dynamic DNS",
    }
    if not records:
        request_json("POST", f"/zones/{zone_id}/dns_records", token, desired)
        return "created"

    current = records[0]
    if current.get("content") == address and current.get("proxied") is False:
        return "unchanged"

    record_id = current.get("id")
    if not isinstance(record_id, str) or not record_id:
        raise CloudflareError("Cloudflare returned a DNS record without an ID")
    request_json(
        "PUT", f"/zones/{zone_id}/dns_records/{record_id}", token, desired
    )
    return "updated"


def main() -> int:
    args = parse_args()
    token = read_token(args.token_file)
    address = discover_public_ipv4()
    action = ensure_dns_record(token, args.zone_id, args.hostname, address)
    print(f"Cloudflare DDNS {action}: {args.hostname}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except CloudflareError as error:
        print(f"Cloudflare DDNS error: {error}", file=sys.stderr)
        raise SystemExit(1)
