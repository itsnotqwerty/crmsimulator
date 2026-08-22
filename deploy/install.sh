#!/usr/bin/env bash

set -euo pipefail
shopt -u patsub_replacement 2>/dev/null || true

usage() {
  cat <<'EOF'
Usage: sudo ./deploy/install.sh --name NAME --command COMMAND [options]

Required:
  --name NAME             Stable systemd/nginx configuration name
  --command COMMAND       Production command for systemd ExecStart

Application:
  -d, --dir PATH          Working directory (default: repository root)
  -u, --user USER         Service user (default: project directory owner)
  -g, --group GROUP       Service group (default: service user's primary group)
  --description TEXT      Systemd description (default: <name> web application)
  -p, --port PORT         Local application port (default: 8000)
  -e, --env FILE          Environment file to copy into project-owned /etc storage
  --config-root PATH      Application config root (default: /etc)
  --skip-build            Do not run the detected Fresh production build

Nginx and TLS:
  -n, --domain NAME       Nginx server_name (default: localhost)
  --cert FILE             TLS certificate chain path
  --key FILE              TLS private key path
  --http-only             Install the HTTP proxy even when certificates exist
  --skip-nginx            Install only the systemd service
  --nginx-dir PATH        Nginx included config directory (default: /etc/nginx/conf.d)
  --client-max-body SIZE  Nginx request body limit (default: 1m)
  --acme-root PATH        ACME challenge root (default: /var/lib/letsencrypt)

System:
  Missing Deno executables are installed into /usr/local/bin automatically.
  --systemd-dir PATH      Systemd unit directory (default: /etc/systemd/system)
  --dry-run               Render configurations without installing or requiring root
  -h, --help              Show this help
EOF
}

require_value() {
  if [[ $# -lt 2 || -z "${2:-}" ]]; then
    echo "Missing value for $1" >&2
    exit 2
  fi
}

reject_newline() {
  local label="$1"
  local value="$2"
  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    echo "$label must not contain newlines." >&2
    exit 2
  fi
}

app_name=""
start_command=""
description=""
project_dir=""
app_user=""
app_group=""
port="8000"
env_source=""
config_root="/etc"
server_name="localhost"
ssl_certificate=""
ssl_certificate_key=""
http_only="false"
skip_nginx="false"
nginx_dir="/etc/nginx/conf.d"
client_max_body_size="1m"
acme_root="/var/lib/letsencrypt"
systemd_dir="/etc/systemd/system"
dry_run="false"
skip_build="false"
cert_was_set="false"
key_was_set="false"
deno_install_root="${DENO_INSTALL_ROOT:-/usr/local}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name)
      require_value "$@"
      app_name="$2"
      shift 2
      ;;
    --command)
      require_value "$@"
      start_command="$2"
      shift 2
      ;;
    -d|--dir)
      require_value "$@"
      project_dir="$2"
      shift 2
      ;;
    -u|--user)
      require_value "$@"
      app_user="$2"
      shift 2
      ;;
    -g|--group)
      require_value "$@"
      app_group="$2"
      shift 2
      ;;
    --description)
      require_value "$@"
      description="$2"
      shift 2
      ;;
    -p|--port)
      require_value "$@"
      port="$2"
      shift 2
      ;;
    -e|--env)
      require_value "$@"
      env_source="$2"
      shift 2
      ;;
    --config-root)
      require_value "$@"
      config_root="$2"
      shift 2
      ;;
    --skip-build)
      skip_build="true"
      shift
      ;;
    -n|--domain)
      require_value "$@"
      server_name="$2"
      shift 2
      ;;
    --cert)
      require_value "$@"
      ssl_certificate="$2"
      cert_was_set="true"
      shift 2
      ;;
    --key)
      require_value "$@"
      ssl_certificate_key="$2"
      key_was_set="true"
      shift 2
      ;;
    --http-only)
      http_only="true"
      shift
      ;;
    --skip-nginx)
      skip_nginx="true"
      shift
      ;;
    --nginx-dir)
      require_value "$@"
      nginx_dir="$2"
      shift 2
      ;;
    --client-max-body)
      require_value "$@"
      client_max_body_size="$2"
      shift 2
      ;;
    --acme-root)
      require_value "$@"
      acme_root="$2"
      shift 2
      ;;
    --systemd-dir)
      require_value "$@"
      systemd_dir="$2"
      shift 2
      ;;
    --dry-run)
      dry_run="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
service_template="${script_dir}/systemd.service.template"
nginx_http_template="${script_dir}/nginx.http.conf.template"
nginx_https_template="${script_dir}/nginx.https.conf.template"

if [[ -z "$app_name" || -z "$start_command" ]]; then
  echo "--name and --command are required." >&2
  usage >&2
  exit 2
fi
if [[ ! "$app_name" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
  echo "--name may contain only letters, numbers, dot, underscore, and hyphen." >&2
  exit 2
fi
if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
  echo "--port must be an integer between 1 and 65535." >&2
  exit 2
fi
if [[ "$start_command" != /* ]]; then
  echo "--command must begin with an absolute executable path." >&2
  exit 2
fi

start_executable="${start_command%% *}"
install_deno="false"
if [[ ! -x "$start_executable" ]]; then
  if [[ "$(basename "$start_executable")" == "deno" ]]; then
    start_command="${deno_install_root%/}/bin/deno${start_command#"$start_executable"}"
    start_executable="${deno_install_root%/}/bin/deno"
    if [[ ! -x "$start_executable" ]]; then
      install_deno="true"
    fi
  else
    echo "Start executable does not exist or is not executable: $start_executable" >&2
    exit 1
  fi
fi

if [[ -z "$project_dir" ]]; then
  project_dir="$repo_root"
fi
if [[ ! -d "$project_dir" ]]; then
  echo "Project directory not found: $project_dir" >&2
  exit 1
fi
project_dir="$(cd "$project_dir" && pwd)"

build_project="false"
if [[
  "$skip_build" == "false" &&
  "$(basename "$start_executable")" == "deno" &&
  -f "$project_dir/deno.json" &&
  -f "$project_dir/dev.ts" &&
  -f "$project_dir/fresh.config.ts"
]]; then
  build_project="true"
fi

if [[ -z "$app_user" ]]; then
  app_user="$(stat -c '%U' "$project_dir")"
fi
if ! id -u "$app_user" >/dev/null 2>&1; then
  echo "Service user does not exist: $app_user" >&2
  exit 1
fi
if [[ -z "$app_group" ]]; then
  app_group="$(id -gn "$app_user")"
fi
if [[ -z "$description" ]]; then
  description="${app_name} web application"
fi

for pair in \
  "name:$app_name" \
  "command:$start_command" \
  "description:$description" \
  "directory:$project_dir" \
  "user:$app_user" \
  "group:$app_group" \
  "domain:$server_name"; do
  reject_newline "${pair%%:*}" "${pair#*:}"
done

if [[ -n "$env_source" ]]; then
  if [[ ! -f "$env_source" ]]; then
    echo "Environment source not found: $env_source" >&2
    exit 1
  fi
  env_source="$(cd "$(dirname "$env_source")" && pwd)/$(basename "$env_source")"
fi

env_dir="${config_root%/}/${app_name}"
env_dest="${env_dir}/${app_name}.env"
service_dest="${systemd_dir%/}/${app_name}.service"
nginx_dest="${nginx_dir%/}/${app_name}.conf"

if [[ -z "$ssl_certificate" ]]; then
  ssl_certificate="/etc/letsencrypt/live/${server_name}/fullchain.pem"
fi
if [[ -z "$ssl_certificate_key" ]]; then
  ssl_certificate_key="/etc/letsencrypt/live/${server_name}/privkey.pem"
fi

use_tls="false"
if [[ "$http_only" == "false" && -f "$ssl_certificate" && -f "$ssl_certificate_key" ]]; then
  use_tls="true"
elif [[ "$http_only" == "false" && ("$cert_was_set" == "true" || "$key_was_set" == "true") ]]; then
  echo "Both TLS certificate files must exist, or use --http-only." >&2
  exit 1
fi

for template in "$service_template"; do
  if [[ ! -f "$template" ]]; then
    echo "Missing deployment template: $template" >&2
    exit 1
  fi
done
if [[ "$skip_nginx" == "false" ]]; then
  selected_nginx_template="$nginx_http_template"
  if [[ "$use_tls" == "true" ]]; then
    selected_nginx_template="$nginx_https_template"
  fi
  if [[ ! -f "$selected_nginx_template" ]]; then
    echo "Missing deployment template: $selected_nginx_template" >&2
    exit 1
  fi
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
rendered_service="${work_dir}/${app_name}.service"
rendered_nginx="${work_dir}/${app_name}.conf"

render_service() {
  local content
  content="$(<"$service_template")"
  content="${content//__DESCRIPTION__/$description}"
  content="${content//__APP_USER__/$app_user}"
  content="${content//__APP_GROUP__/$app_group}"
  content="${content//__APP_DIR__/$project_dir}"
  content="${content//__PORT__/$port}"
  content="${content//__ENV_FILE__/$env_dest}"
  content="${content//__START_COMMAND__/$start_command}"
  printf '%s\n' "$content" > "$rendered_service"
}

render_nginx() {
  local content
  content="$(<"$selected_nginx_template")"
  content="${content//__SERVER_NAME__/$server_name}"
  content="${content//__PORT__/$port}"
  content="${content//__CLIENT_MAX_BODY_SIZE__/$client_max_body_size}"
  content="${content//__ACME_ROOT__/$acme_root}"
  content="${content//__SSL_CERTIFICATE__/$ssl_certificate}"
  content="${content//__SSL_CERTIFICATE_KEY__/$ssl_certificate_key}"
  printf '%s\n' "$content" > "$rendered_nginx"
}

render_service
if [[ "$skip_nginx" == "false" ]]; then
  render_nginx
fi

if grep -q '__[A-Z0-9_]*__' "$rendered_service"; then
  echo "Unresolved placeholder in rendered systemd service." >&2
  exit 1
fi
if [[ "$skip_nginx" == "false" ]] && grep -q '__[A-Z0-9_]*__' "$rendered_nginx"; then
  echo "Unresolved placeholder in rendered nginx config." >&2
  exit 1
fi

if [[ "$dry_run" == "true" ]]; then
  if [[ "$install_deno" == "true" ]]; then
    printf '%s\n' "--- install Deno -> ${start_executable}"
  fi
  if [[ "$build_project" == "true" ]]; then
    printf '%s\n' "--- build ${project_dir}: ${start_executable} task build"
  fi
  printf '%s\n' "--- ${service_dest}"
  cat "$rendered_service"
  if [[ "$skip_nginx" == "false" ]]; then
    printf '%s\n' "--- ${nginx_dest}"
    cat "$rendered_nginx"
  fi
  if [[ -n "$env_source" ]]; then
    printf '%s\n' "--- copy ${env_source} -> ${env_dest} (mode 0600)"
  fi
  exit 0
fi

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run this installer as root, or use --dry-run." >&2
  exit 1
fi
if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl is required." >&2
  exit 1
fi
if [[ "$install_deno" == "true" ]]; then
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to install Deno." >&2
    exit 1
  fi
  deno_installer="${work_dir}/install-deno.sh"
  curl --proto '=https' --tlsv1.2 -fsSL \
    https://deno.land/install.sh -o "$deno_installer"
  DENO_INSTALL="$deno_install_root" sh "$deno_installer"
fi
if [[ ! -x "$start_executable" ]]; then
  echo "Start executable does not exist or is not executable: $start_executable" >&2
  exit 1
fi
if ! runuser -u "$app_user" -- test -x "$project_dir"; then
  echo "Service user '$app_user' cannot traverse '$project_dir'." >&2
  exit 1
fi
if ! runuser -u "$app_user" -- test -x "$start_executable"; then
  echo "Service user '$app_user' cannot execute '$start_executable'." >&2
  exit 1
fi
if [[ "$skip_nginx" == "false" ]] && ! command -v nginx >/dev/null 2>&1; then
  echo "nginx is required unless --skip-nginx is used." >&2
  exit 1
fi
if [[ "$build_project" == "true" ]]; then
  app_home="$(getent passwd "$app_user" | cut -d: -f6)"
  printf '%s\n' "Building Fresh production assets as ${app_user}..."
  (
    cd "$project_dir"
    runuser -u "$app_user" -- env HOME="$app_home" \
      "$start_executable" task build
  )
fi

install -d -m 0755 "$systemd_dir"
install -d -m 0755 "$env_dir"
if [[ -n "$env_source" ]]; then
  install -m 0600 "$env_source" "$env_dest"
fi
install -m 0644 "$rendered_service" "$service_dest"

nginx_backup=""
if [[ "$skip_nginx" == "false" ]]; then
  install -d -m 0755 "$nginx_dir"
  if [[ -f "$nginx_dest" ]]; then
    nginx_backup="${work_dir}/nginx.backup"
    cp "$nginx_dest" "$nginx_backup"
  fi
  install -m 0644 "$rendered_nginx" "$nginx_dest"
  if ! nginx -t; then
    if [[ -n "$nginx_backup" ]]; then
      cp "$nginx_backup" "$nginx_dest"
    else
      rm -f "$nginx_dest"
    fi
    echo "nginx validation failed; restored the previous configuration." >&2
    exit 1
  fi
fi

systemctl daemon-reload
systemctl enable "$app_name.service"
systemctl restart "$app_name.service"

if [[ "$skip_nginx" == "false" ]]; then
  systemctl enable nginx
  systemctl reload nginx
fi

printf '%s\n' "Installed systemd unit: ${service_dest}"
if [[ -n "$env_source" ]]; then
  printf '%s\n' "Installed environment file: ${env_dest}"
fi
if [[ "$skip_nginx" == "false" ]]; then
  printf '%s\n' "Installed nginx config: ${nginx_dest}"
  if [[ "$use_tls" != "true" ]]; then
    printf '%s\n' "TLS is not enabled. Obtain certificates and rerun without --http-only."
  fi
fi
