# PrairieLearn Self-Hosting Notes

## Quick Start (Docker)

```sh
docker build -t prairielearn/prairielearn:local .

docker run -d --rm -p 3000:3000 \
  -v /Users/ran/workspace/tracing_questions:/course \
  -v /Users/ran/workspace/PrairieLearn/config.json:/PrairieLearn/config.json:ro \
  -v /Users/ran/.config/prairielearn/docker-config.json:/root/.config/prairielearn/config.json:ro \
  --name pl-training \
  prairielearn/prairielearn:local
```

After startup, log in as admin and click **Load from disk** to sync the course.

## Config Files

### `config.json` (repo root, safe to commit)

```json
{
  "authUid": "asatheghost@gmail.com",
  "authName": "Ran",
  "devModeAutoLogin": false
}
```

- `authUid` / `authName`: The admin account UID. On startup, `insertDevUser()` creates this user and adds it to the `administrators` table.
- `devModeAutoLogin`: When `false`, visitors are **not** auto-logged in as admin. Everyone sees the login form at `/pl/login`. The "Dev Mode Bypass" button (which reveals the admin UID) is also hidden.

### `~/.config/prairielearn/docker-config.json` (local only, NOT in repo)

```json
{
  "aiGradingAnthropicApiKey": "sk-ant-..."
}
```

This file holds secrets. It is mounted into the container at `/root/.config/prairielearn/config.json`. PrairieLearn loads configs in order: `~/.config/prairielearn/config.json` first, then `/PrairieLearn/config.json` (repo root). Values from later files override earlier ones, but since these two files have non-overlapping keys, both take effect.

## Authentication

### Dev Mode (current setup)

Dev mode is ON by default (when `NODE_ENV` is not `production`). Students log in via a form at `/pl/login` where they type:

- **UID** (email) — becomes their identity
- **Name**
- **UIN** (optional)

No password. Accounts are auto-created on first login via `users_select_or_insert()`.

With `devModeAutoLogin: false`, the auto-login as admin is disabled. Students see only the login form. The admin logs in by typing their `authUid` into the same form.

### Other Options (not currently used)

- **Google OAuth**: Set `hasOauth`, `googleClientId`, `googleClientSecret`, `googleRedirectUrl` in config.
- **Shibboleth / trusted headers**: Set `hasShib: true`. A reverse proxy sets `x-trust-auth-uid` / `x-trust-auth-name` / `x-trust-auth-uin` headers on `/pl/shibcallback`.
- **SAML / Azure**: Enterprise features, require additional setup.

## Student Enrollment

### Self-Enrollment via Direct Link

Students visit the course instance URL (e.g., `http://host:3000/pl/course_instance/5`) and are enrolled automatically.

Required in `infoCourseInstance.json`:

```json
{
  "selfEnrollment": {
    "enabled": true,
    "restrictToInstitution": false
  }
}
```

`restrictToInstitution` must be `false` for dev mode, since all dev-mode users belong to the default institution.

### What Can Block Enrollment

- `selfEnrollment.enabled` is `false` or missing
- `allowAccess` date range has expired
- `restrictToInstitution` is `true` and user's institution doesn't match
- Student was previously blocked by an instructor

## Code Changes (on `ai_feedback` branch)

### `devModeAutoLogin` feature

Three files changed:

1. **`apps/prairielearn/src/lib/config.ts`** — Added `devModeAutoLogin` option (default `true`).
2. **`apps/prairielearn/src/middlewares/authn.ts`** — Auto-login gated on `config.devModeAutoLogin`.
3. **`apps/prairielearn/src/pages/authLogin/authLogin.html.ts`** — "Dev Mode Bypass" button hidden when `devModeAutoLogin` is `false`.

### `insertDevUser()` fix

**`apps/prairielearn/src/server.ts`** — `insertDevUser()` was hardcoded to `dev@example.com`. Changed to use `config.authUid` and `config.authName`, so the configured admin UID gets admin privileges.

## Useful Commands

```sh
# Stop the container
docker stop pl-training

# View logs
docker logs pl-training

# Check for AI hints errors
docker logs pl-training 2>&1 | grep -i error | tail -20

# Query the database
docker exec pl-training psql -U postgres -d postgres -c "SELECT id, long_name FROM course_instances;"
```
