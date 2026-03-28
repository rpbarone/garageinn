#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import secrets
import string
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
DOCS_MIGRATIONS_DIR = ROOT_DIR / "docs" / "database" / "migrations"
SUPABASE_MIGRATIONS_DIR = ROOT_DIR / "supabase" / "migrations"
SEEDS_DIR = ROOT_DIR / "docs" / "database" / "seeds"
MCP_OVERRIDES_PATH = Path.home() / ".mcp-overrides.json"

DEFAULT_PROJECT_REF = "hjuxmztpgwruyvhvpcfb"
DEFAULT_SITE_URL = "https://garageinn-legacy.2mow.org"
DEFAULT_REDIRECT_URLS = [
    "https://garageinn-legacy.2mow.org/auth/callback",
    "https://garageinn-legacy.2mow.org/redefinir-senha",
]
DEFAULT_ADMIN_EMAIL = "admin@garageinn.com.br"
ENV_FILE = ROOT_DIR / ".env"
ADMIN_ENV_FILE = ROOT_DIR / ".env.admin-bootstrap"
BOOTSTRAP_STATE_TABLE = "public.bootstrap_execution_history"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bootstrap the hosted Supabase project for garageinn legacy.")
    parser.add_argument("--project-ref", default=DEFAULT_PROJECT_REF)
    parser.add_argument("--access-token", default="")
    parser.add_argument("--site-url", default=DEFAULT_SITE_URL)
    parser.add_argument("--redirect-url", action="append", default=[])
    parser.add_argument("--admin-email", default=DEFAULT_ADMIN_EMAIL)
    parser.add_argument("--admin-password", default="")
    parser.add_argument("--skip-auth-config", action="store_true")
    parser.add_argument("--skip-migrations", action="store_true")
    parser.add_argument("--skip-seeds", action="store_true")
    parser.add_argument("--skip-admin-user", action="store_true")
    parser.add_argument("--write-env", action="store_true")
    parser.add_argument("--tunnel-token", default="")
    parser.add_argument("--next-public-site-url", default=DEFAULT_SITE_URL)
    return parser.parse_args()


def load_access_token(explicit: str) -> str:
    if explicit:
        return explicit

    for env_name in ("SUPABASE_ACCESS_TOKEN", "SUPABASE_PAT"):
        value = os.getenv(env_name, "")
        if value:
            return value

    if MCP_OVERRIDES_PATH.exists():
        data = json.loads(MCP_OVERRIDES_PATH.read_text())
        value = data.get("SUPABASE_ACCESS_TOKEN", "")
        if value:
            return value

    raise SystemExit("Supabase access token not found. Pass --access-token or set SUPABASE_ACCESS_TOKEN.")


class HttpClient:
    def __init__(self, base_url: str, headers: dict[str, str]) -> None:
        self.base_url = base_url.rstrip("/")
        self.headers = headers

    def request(self, method: str, path: str, payload: dict | list | None = None) -> tuple[int, str]:
        data = None
        if payload is not None:
            data = json.dumps(payload).encode()

        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            headers=self.headers,
            method=method,
        )

        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.status, response.read().decode()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read().decode()


class SupabaseManagement:
    def __init__(self, access_token: str, project_ref: str) -> None:
        self.project_ref = project_ref
        self.client = HttpClient(
            "https://api.supabase.com/v1",
            {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "curl/8.5.0",
            },
        )

    def get_api_keys(self) -> list[dict]:
        status, body = self.client.request("GET", f"/projects/{self.project_ref}/api-keys")
        if status != 200:
            raise SystemExit(f"Failed to get API keys: {status} {body}")
        return json.loads(body)

    def patch_auth_config(self, site_url: str, redirect_urls: list[str]) -> dict:
        payload = {
            "site_url": site_url,
            "uri_allow_list": ",".join(redirect_urls),
        }
        status, body = self.client.request("PATCH", f"/projects/{self.project_ref}/config/auth", payload)
        if status != 200:
            raise SystemExit(f"Failed to patch auth config: {status} {body}")
        return json.loads(body)

    def execute_sql(self, query: str, label: str) -> list[dict]:
        status, body = self.client.request(
            "POST",
            f"/projects/{self.project_ref}/database/query",
            {"query": query},
        )
        if status not in (200, 201):
            raise SystemExit(f"Failed to execute SQL for {label}: {status} {body}")
        return json.loads(body)


class SupabaseAuthAdmin:
    def __init__(self, project_ref: str, service_role_key: str) -> None:
        self.client = HttpClient(
            f"https://{project_ref}.supabase.co",
            {
                "apikey": service_role_key,
                "Authorization": f"Bearer {service_role_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "curl/8.5.0",
            },
        )

    def list_users(self) -> list[dict]:
        users: list[dict] = []
        page = 1
        per_page = 100
        while True:
            status, body = self.client.request("GET", f"/auth/v1/admin/users?page={page}&per_page={per_page}")
            if status != 200:
                raise SystemExit(f"Failed to list auth users: {status} {body}")
            payload = json.loads(body)
            page_users = payload.get("users", [])
            users.extend(page_users)
            if len(page_users) < per_page:
                break
            page += 1
        return users

    def ensure_user(self, email: str, password: str) -> tuple[str, bool]:
        normalized_email = email.strip().lower()
        for user in self.list_users():
            if (user.get("email") or "").strip().lower() == normalized_email:
                return user["id"], False

        payload = {
            "email": normalized_email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"full_name": "Administrador do Sistema"},
        }
        status, body = self.client.request("POST", "/auth/v1/admin/users", payload)
        if status not in (200, 201):
            raise SystemExit(f"Failed to create auth user: {status} {body}")
        return json.loads(body)["id"], True

    def update_password(self, user_id: str, password: str) -> None:
        payload = {
            "password": password,
            "email_confirm": True,
        }
        status, body = self.client.request("PUT", f"/auth/v1/admin/users/{user_id}", payload)
        if status not in (200, 204):
            raise SystemExit(f"Failed to update auth user password: {status} {body}")


def sorted_sql_files(directory: Path) -> list[Path]:
    return sorted(directory.glob("*.sql"))


def render_seed(seed_path: Path, replacements: dict[str, str] | None = None) -> str:
    content = seed_path.read_text()
    for old, new in (replacements or {}).items():
        content = content.replace(old, new)
    return content


def render_admin_seed(seed_path: Path, admin_user_id: str) -> str:
    content = seed_path.read_text()
    content = content.replace("v_admin_id uuid := 'SEU_UUID_AQUI';", f"v_admin_id uuid := '{admin_user_id}';")
    content = content.replace("IF v_admin_id = 'SEU_UUID_AQUI' THEN", "IF false THEN")
    return content


def generate_password() -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*()-_=+"
    while True:
        value = "".join(secrets.choice(alphabet) for _ in range(22))
        if (
            any(ch.islower() for ch in value)
            and any(ch.isupper() for ch in value)
            and any(ch.isdigit() for ch in value)
            and any(not ch.isalnum() for ch in value)
        ):
            return value


def write_env_file(path: Path, values: dict[str, str]) -> None:
    lines = [f"{key}={value}" for key, value in values.items()]
    path.write_text("\n".join(lines) + "\n")
    os.chmod(path, 0o600)


def json_scalar(rows: list[dict], key: str) -> int:
    if not rows:
        return 0
    value = rows[0].get(key, 0)
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def ensure_bootstrap_state_table(management: SupabaseManagement) -> None:
    management.execute_sql(
        f"""
        create table if not exists {BOOTSTRAP_STATE_TABLE} (
          key text primary key,
          kind text not null,
          applied_at timestamptz not null default now()
        )
        """,
        "bootstrap_state_table",
    )


def mark_applied(management: SupabaseManagement, key: str, kind: str) -> None:
    management.execute_sql(
        f"""
        insert into {BOOTSTRAP_STATE_TABLE} (key, kind)
        values ('{key}', '{kind}')
        on conflict (key) do nothing
        """,
        f"mark {key}",
    )


def is_marked(management: SupabaseManagement, key: str) -> bool:
    rows = management.execute_sql(
        f"select count(*) as count from {BOOTSTRAP_STATE_TABLE} where key = '{key}'",
        f"state check {key}",
    )
    return json_scalar(rows, "count") > 0


def reconcile_existing_state(management: SupabaseManagement) -> None:
    probes = [
        (
            "migration:001_create_tables.sql",
            "migration",
            "select to_regclass('public.departments') is not null as ok",
        ),
        (
            "migration:002_create_functions.sql",
            "migration",
            "select count(*) as count from pg_proc where proname = 'is_admin' and pronamespace = 'public'::regnamespace",
        ),
        (
            "migration:003_create_rls_policies.sql",
            "migration",
            "select count(*) as count from pg_policies where schemaname = 'public' and policyname = 'profiles_select_all'",
        ),
        (
            "migration:009_create_ticket_attachments_storage.sql",
            "migration",
            "select count(*) as count from pg_policies where schemaname = 'storage' and policyname = 'ticket_attachments_storage_select'",
        ),
        (
            "seed:001_departments_roles.sql",
            "seed",
            "select count(*) as count from public.departments",
        ),
        (
            "seed:002_admin_user.sql",
            "seed",
            "select count(*) as count from public.profiles where email = 'admin@garageinn.com.br'",
        ),
        (
            "seed:003_ticket_categories.sql",
            "seed",
            "select count(*) as count from public.ticket_categories",
        ),
        (
            "seed:004_checklist_template.sql",
            "seed",
            "select count(*) as count from public.checklist_templates where name = 'Checklist de Abertura - Padrão'",
        ),
        (
            "seed:005_system_settings.sql",
            "seed",
            "select count(*) as count from public.system_settings",
        ),
    ]

    for key, kind, probe_sql in probes:
        if is_marked(management, key):
            continue
        rows = management.execute_sql(probe_sql, f"probe {key}")
        sample = rows[0] if rows else {}
        if sample.get("ok") is True or json_scalar(rows, "count") > 0:
            mark_applied(management, key, kind)


def ensure_can_view_ticket_compat(management: SupabaseManagement) -> None:
    management.execute_sql(
        """
        create or replace function public.can_view_ticket(p_ticket_id uuid)
        returns boolean
        language plpgsql
        security definer
        set search_path = public
        as $$
        declare
          v_ticket record;
        begin
          select *
          into v_ticket
          from public.tickets
          where id = p_ticket_id;

          if v_ticket is null then
            return false;
          end if;

          if public.is_admin() then
            return true;
          end if;

          if v_ticket.created_by = auth.uid() or v_ticket.assigned_to = auth.uid() then
            return true;
          end if;

          if exists (
            select 1
            from public.user_roles ur
            join public.roles r on r.id = ur.role_id
            where ur.user_id = auth.uid()
              and r.department_id = v_ticket.department_id
          ) then
            return true;
          end if;

          if exists (
            select 1
            from public.user_units uu
            where uu.user_id = auth.uid()
              and uu.unit_id = v_ticket.unit_id
          ) then
            return true;
          end if;

          return false;
        end;
        $$;
        """,
        "compat can_view_ticket",
    )


def run_migration(management: SupabaseManagement, path: Path) -> None:
    state_key = f"migration:{path.name}"
    if is_marked(management, state_key):
        return

    sql = path.read_text()
    if path.name == "003_create_rls_policies.sql":
        ensure_can_view_ticket_compat(management)
    elif path.name == "009_create_ticket_attachments_storage.sql":
        sql = sql.replace("ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;\n", "")

    management.execute_sql(sql, path.name)
    mark_applied(management, state_key, "migration")


def run_seed(management: SupabaseManagement, path: Path, rendered_sql: str) -> None:
    state_key = f"seed:{path.name}"
    if is_marked(management, state_key):
        return

    management.execute_sql(rendered_sql, path.name)
    mark_applied(management, state_key, "seed")


def main() -> int:
    args = parse_args()
    redirect_urls = args.redirect_url or list(DEFAULT_REDIRECT_URLS)
    access_token = load_access_token(args.access_token)
    management = SupabaseManagement(access_token, args.project_ref)

    api_keys = management.get_api_keys()
    anon_key = next(item["api_key"] for item in api_keys if item["name"] == "anon")
    service_role_key = next(item["api_key"] for item in api_keys if item["name"] == "service_role")

    ensure_bootstrap_state_table(management)
    reconcile_existing_state(management)

    if not args.skip_auth_config:
        management.patch_auth_config(args.site_url, redirect_urls)

    if not args.skip_migrations:
        for path in sorted_sql_files(DOCS_MIGRATIONS_DIR):
            run_migration(management, path)
        for path in sorted_sql_files(SUPABASE_MIGRATIONS_DIR):
            run_migration(management, path)

    admin_password = args.admin_password or generate_password()
    admin_user_id = ""
    admin_user_created = False

    if not args.skip_admin_user:
        auth_admin = SupabaseAuthAdmin(args.project_ref, service_role_key)
        admin_user_id, admin_user_created = auth_admin.ensure_user(args.admin_email, admin_password)
        auth_admin.update_password(admin_user_id, admin_password)

    if not args.skip_seeds:
        run_seed(management, SEEDS_DIR / "001_departments_roles.sql", render_seed(SEEDS_DIR / "001_departments_roles.sql"))
        if admin_user_id:
            run_seed(
                management,
                SEEDS_DIR / "002_admin_user.sql",
                render_admin_seed(SEEDS_DIR / "002_admin_user.sql", admin_user_id),
            )
        run_seed(management, SEEDS_DIR / "003_ticket_categories.sql", render_seed(SEEDS_DIR / "003_ticket_categories.sql"))
        run_seed(management, SEEDS_DIR / "005_system_settings.sql", render_seed(SEEDS_DIR / "005_system_settings.sql"))
        if admin_user_id:
            run_seed(management, SEEDS_DIR / "004_checklist_template.sql", render_seed(SEEDS_DIR / "004_checklist_template.sql"))

    verification = management.execute_sql(
        """
        select
          (select count(*) from public.departments) as departments_count,
          (select count(*) from public.roles) as roles_count,
          (select count(*) from public.ticket_categories) as ticket_categories_count,
          (select count(*) from public.system_settings) as system_settings_count,
          (select count(*) from public.profiles where email = 'admin@garageinn.com.br') as admin_profile_count
        """,
        "verification",
    )

    if args.write_env:
        if not args.tunnel_token:
            raise SystemExit("--write-env requires --tunnel-token")
        write_env_file(
            ENV_FILE,
            {
                "COMPOSE_PROJECT_NAME": "garageinn-legacy",
                "WEB_IMAGE": "garageinn-legacy-web:local",
                "NEXT_PUBLIC_SUPABASE_URL": f"https://{args.project_ref}.supabase.co",
                "NEXT_PUBLIC_SUPABASE_ANON_KEY": anon_key,
                "NEXT_PUBLIC_SITE_URL": args.next_public_site_url,
                "NEXT_PUBLIC_VERCEL_URL": "",
                "CLOUDFLARE_TUNNEL_TOKEN": args.tunnel_token,
            },
        )

    if admin_user_id:
        write_env_file(
            ADMIN_ENV_FILE,
            {
                "ADMIN_EMAIL": args.admin_email,
                "ADMIN_PASSWORD": admin_password,
                "ADMIN_USER_ID": admin_user_id,
            },
        )

    summary = {
        "project_ref": args.project_ref,
        "project_url": f"https://{args.project_ref}.supabase.co",
        "site_url": args.site_url,
        "redirect_urls": redirect_urls,
        "admin_email": args.admin_email,
        "admin_user_id": admin_user_id,
        "admin_user_created": admin_user_created,
        "admin_credentials_file": str(ADMIN_ENV_FILE) if admin_user_id else "",
        "env_file": str(ENV_FILE) if args.write_env else "",
        "verification": verification,
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
