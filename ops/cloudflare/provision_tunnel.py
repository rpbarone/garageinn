#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_ZONE_NAME = "2mow.org"
DEFAULT_TUNNEL_NAME = "garageinn-legacy"
DEFAULT_HOSTNAME = "garageinn-legacy.2mow.org"
DEFAULT_SERVICE = "http://garageinn-legacy-web:3000"
MCP_OVERRIDES_PATH = Path.home() / ".mcp-overrides.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Provision a remote-managed Cloudflare Tunnel.")
    parser.add_argument("--zone-name", default=DEFAULT_ZONE_NAME)
    parser.add_argument("--tunnel-name", default=DEFAULT_TUNNEL_NAME)
    parser.add_argument("--hostname", default=DEFAULT_HOSTNAME)
    parser.add_argument("--service", default=DEFAULT_SERVICE)
    parser.add_argument("--token", default="")
    parser.add_argument("--reveal-token", action="store_true")
    return parser.parse_args()


def load_api_token(explicit_token: str) -> str:
    if explicit_token:
        return explicit_token

    for env_name in ("CF_API_TOKEN", "CLOUDFLARE_API_TOKEN"):
        value = os.getenv(env_name, "")
        if value:
            return value

    if MCP_OVERRIDES_PATH.exists():
        try:
            data = json.loads(MCP_OVERRIDES_PATH.read_text())
        except json.JSONDecodeError as exc:
            raise SystemExit(f"Invalid JSON in {MCP_OVERRIDES_PATH}: {exc}") from exc
        for key_name in ("CF_API_TOKEN", "CLOUDFLARE_API_TOKEN"):
            value = data.get(key_name, "")
            if value:
                return value

    raise SystemExit("Cloudflare API token not found. Use --token or CF_API_TOKEN.")


class CloudflareClient:
    def __init__(self, token: str) -> None:
        self._base_url = "https://api.cloudflare.com/client/v4"
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    def request(self, method: str, path: str, payload: dict | None = None) -> dict:
        data = None
        if payload is not None:
            data = json.dumps(payload).encode()

        request = urllib.request.Request(
            f"{self._base_url}{path}",
            data=data,
            headers=self._headers,
            method=method,
        )

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read().decode()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode()
            raise SystemExit(f"Cloudflare API error {exc.code}: {detail}") from exc

        payload = json.loads(body)
        if not payload.get("success", False):
            raise SystemExit(f"Cloudflare API unsuccessful response: {body}")
        return payload


def get_zone_and_account(client: CloudflareClient, zone_name: str) -> tuple[str, str]:
    query = urllib.parse.urlencode({"name": zone_name})
    payload = client.request("GET", f"/zones?{query}")
    results = payload.get("result", [])
    if not results:
        raise SystemExit(f"Zone not found: {zone_name}")
    zone = results[0]
    return zone["id"], zone["account"]["id"]


def ensure_tunnel(client: CloudflareClient, account_id: str, tunnel_name: str) -> dict:
    payload = client.request("GET", f"/accounts/{account_id}/cfd_tunnel")
    results = payload.get("result", [])
    for tunnel in results:
        if tunnel.get("name") == tunnel_name:
            return tunnel

    payload = client.request(
        "POST",
        f"/accounts/{account_id}/cfd_tunnel",
        {
            "name": tunnel_name,
            "config_src": "cloudflare",
        },
    )
    return payload["result"]


def ensure_tunnel_config(
    client: CloudflareClient,
    account_id: str,
    tunnel_id: str,
    hostname: str,
    service: str,
) -> None:
    client.request(
        "PUT",
        f"/accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations",
        {
            "config": {
                "ingress": [
                    {
                        "hostname": hostname,
                        "service": service,
                        "originRequest": {},
                    },
                    {
                        "service": "http_status:404",
                    },
                ]
            }
        },
    )


def ensure_dns_record(
    client: CloudflareClient,
    zone_id: str,
    hostname: str,
    tunnel_id: str,
) -> dict:
    content = f"{tunnel_id}.cfargotunnel.com"
    query = urllib.parse.urlencode({"name": hostname})
    payload = client.request("GET", f"/zones/{zone_id}/dns_records?{query}")
    results = payload.get("result", [])

    desired = {
        "type": "CNAME",
        "proxied": True,
        "name": hostname,
        "content": content,
    }

    if not results:
        return client.request("POST", f"/zones/{zone_id}/dns_records", desired)["result"]

    record = results[0]
    if (
        record.get("type") == desired["type"]
        and record.get("proxied") == desired["proxied"]
        and record.get("content") == desired["content"]
    ):
        return record

    record_id = record["id"]
    return client.request("PUT", f"/zones/{zone_id}/dns_records/{record_id}", desired)["result"]


def get_tunnel_token(client: CloudflareClient, account_id: str, tunnel_id: str) -> str:
    payload = client.request("GET", f"/accounts/{account_id}/cfd_tunnel/{tunnel_id}/token")
    result = payload.get("result", "")
    if isinstance(result, dict):
        return result.get("token", "")
    return result


def mask_secret(value: str) -> str:
    if len(value) <= 8:
        return value
    return f"{value[:4]}...{value[-4:]}"


def main() -> int:
    args = parse_args()
    token = load_api_token(args.token)
    client = CloudflareClient(token)

    zone_id, account_id = get_zone_and_account(client, args.zone_name)
    tunnel = ensure_tunnel(client, account_id, args.tunnel_name)
    tunnel_id = tunnel["id"]
    ensure_tunnel_config(client, account_id, tunnel_id, args.hostname, args.service)
    record = ensure_dns_record(client, zone_id, args.hostname, tunnel_id)
    tunnel_token = get_tunnel_token(client, account_id, tunnel_id)

    summary = {
        "zone_name": args.zone_name,
        "zone_id": zone_id,
        "account_id": account_id,
        "tunnel_name": args.tunnel_name,
        "tunnel_id": tunnel_id,
        "tunnel_status": tunnel.get("status", ""),
        "hostname": args.hostname,
        "service": args.service,
        "dns_record_id": record.get("id", ""),
        "dns_record_type": record.get("type", ""),
        "dns_record_content": record.get("content", ""),
        "tunnel_token": tunnel_token if args.reveal_token else mask_secret(tunnel_token),
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
