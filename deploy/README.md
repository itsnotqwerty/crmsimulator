# Generic web service deployment

This folder installs any long-running web application behind nginx and systemd.
When a configured Deno executable is missing, it installs the latest stable Deno
release into `/usr/local/bin`. Other runtimes, application dependencies, nginx,
and TLS certificates remain prerequisites.

## Required inputs

- `--name`: stable service/configuration name using letters, numbers, `.`, `_`,
  or `-`;
- `--command`: absolute production start command as systemd should execute it;
- `--domain`: nginx `server_name`;
- `--dir`: application working directory when it is not the repository root.

Example for this Fresh application:

```bash
sudo ./deploy/install.sh \
  --name crm-simulator \
  --domain crm.example.com \
  --command "/usr/local/bin/deno run -A main.ts" \
  --env .env
```

The referenced environment file must define a stable, high-entropy
`COOKIE_SECRET`. Use HTTPS for production; otherwise browsers will not receive
the save cookies with the required `Secure` attribute. Keep the same secret
across deployments or existing saves will become unreadable.

Example for another project:

```bash
sudo ./deploy/install.sh \
  --name inventory-web \
  --dir /srv/inventory-web \
  --domain inventory.example.com \
  --port 3000 \
  --command "/usr/bin/node server.js" \
  --env /srv/inventory-web/.env.production
```

Use `--dry-run` without root to inspect rendered systemd and nginx files. Use
`--skip-nginx` when another reverse proxy or load balancer owns ingress.
Dry-run output reports when Deno would be installed. Before writing the systemd
unit, a real installation verifies that the service user can execute the chosen
runtime, preventing a delayed `203/EXEC` service failure.

## TLS

When both certificate files exist, the installer uses the HTTPS template and
redirects ordinary HTTP traffic to HTTPS. Defaults follow the Let's Encrypt
layout for the selected domain. Use `--cert` and `--key` for other locations, or
`--http-only` to intentionally install the HTTP template.

The installer never obtains certificates. A common bootstrap sequence is:

1. install with `--http-only`;
2. obtain a certificate using the ACME client of your choice;
3. rerun without `--http-only`.

## Installed files

For an application named `inventory-web`, defaults are:

- `/etc/systemd/system/inventory-web.service`;
- `/etc/inventory-web/inventory-web.env` when `--env` is supplied;
- `/etc/nginx/conf.d/inventory-web.conf` unless `--skip-nginx` is used.

Existing destination files are replaced only after all templates render. The
installer validates nginx before restarting the application. It does not remove
nginx's default site or alter unrelated project configuration.

## Environment behavior

`PORT` is supplied directly by the systemd unit. An env source is optional. When
provided, it is copied to a project-specific `/etc` directory with mode `0600`.
The generated unit uses an optional `EnvironmentFile`, so projects that need no
env file do not require a placeholder.

Rerunning the installer updates the same project-owned files and restarts only
the selected service.
