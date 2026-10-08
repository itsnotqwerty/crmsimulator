# Local PostgreSQL

Use PostgreSQL 16+ on the same server as the Deno application. Multiple games
can share one PostgreSQL instance, but give each a separate database and login
role. Bind PostgreSQL to localhost; do not expose port 5432 publicly. Containers
must use a private network or an explicitly configured host connection instead
of assuming their localhost is the host server.

## Provision

Install PostgreSQL using your host's package manager. As the database administrator,
run these commands yourself (the password prompt stays in your terminal):

```sh
sudo -u postgres createuser --pwprompt crmsimulator
sudo -u postgres createdb --owner=crmsimulator crmsimulator
```

Set `DATABASE_URL=postgres://crmsimulator:<URL-encoded-password>@127.0.0.1:5432/crmsimulator`,
`DENO_ENV=production`, and the existing `COOKIE_SECRET` in the service environment.
Export `DATABASE_URL` in the maintenance shell before running:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/schema.sql
```

Use the existing systemd/nginx deployment entrypoint. Keep the database role
non-superuser, keep credentials out of source control, and restrict the service
environment file to its owner. Use HTTPS for the public application.

## Import Existing Saves

1. Back up Supabase and keep the old deployment available for rollback.
2. Stop application writes, including any old cloud deployment.
3. Apply the new schema to an empty local database.
4. Set `SOURCE_DATABASE_URL` to the Supabase direct PostgreSQL connection or
   session-mode pooler URL. Use a PostgreSQL client at least as new as the source
   server, with verified TLS according to the source provider's instructions.
5. Transfer only the application data, not Supabase roles, extensions or policies:

```sh
umask 077
pg_dump "$SOURCE_DATABASE_URL" --data-only --column-inserts --no-owner \
  --no-privileges --table=public.crm_anonymous_saves > crm-saves.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f crm-saves.sql
```

Treat the dump as private user data. A duplicate ID causes the whole restore to
roll back. Keep the same site hostname, browser cookie, save IDs, token hashes,
and `COOKIE_SECRET`; existing saves then remain accessible without accounts.
Compare source/destination row counts and verify load, save, conflict handling,
import/export and reset with a test browser before allowing traffic.

Deploy with `DATABASE_URL`, remove obsolete `SUPABASE_*` variables, and retain
the source backup until the local deployment is verified. Do not cancel/delete
Supabase until restore testing and cutover are complete. Rolling back after new
local writes requires moving those writes back; never run both writers at once.

## Operations

Schedule `pg_dump -Fc "$DATABASE_URL"` backups to a protected location outside
the application host and regularly test `pg_restore` into a separate database.
Monitor disk space, database availability, and application save failures.
Run the database test against an isolated database with the schema installed:

```sh
TEST_DATABASE_URL="$DATABASE_URL" deno test -A lib/persistence/save_store.test.ts
```

No production environment files or live databases are modified by this code migration.