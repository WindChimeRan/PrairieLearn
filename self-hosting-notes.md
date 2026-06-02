# PrairieLearn Self-Hosting Notes

## Quick Start (Docker)

```sh
docker build -t prairielearn/prairielearn:local .

docker run -d -p 3000:3000 \
  -v pl-db:/var/postgres \
  -v $HOME/tracing_questions:/course \
  -v $HOME/PrairieLearn/config.json:/PrairieLearn/config.json:ro \
  -v $HOME/.config/prairielearn/docker-config.json:/root/.config/prairielearn/config.json:ro \
  --name pl-training \
  prairielearn/prairielearn:local
```

After startup, log in as admin and click **Load from disk** to sync the course.

## CRITICAL: Data Persistence

PostgreSQL stores all student data at `/var/postgres` inside the container. **Without a volume mount, all data is lost when the container stops.**

The `-v pl-db:/var/postgres` flag in the launch command creates a named Docker volume that persists across container restarts/rebuilds.

```sh
# Verify the volume exists
docker volume ls | grep pl-db

# Inspect the volume
docker volume inspect pl-db
```

**Do NOT use `--rm` in the docker run command** — it deletes the container on exit and can complicate data recovery.

### Backup

Always back up the database before stopping the container or rebuilding:

```sh
# SQL dump (portable, can be loaded into any PostgreSQL)
docker exec pl-training pg_dump -U postgres postgres > pl_backup_$(date +%Y%m%d_%H%M%S).sql

# Restore from backup (into a running container)
docker exec -i pl-training psql -U postgres postgres < pl_backup_20260310_120000.sql
```

## Config Files

### `config.json` (in repo, safe to commit)

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

On a cloud VM, create this file at `~/.config/prairielearn/docker-config.json` before launching the container.

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

Students visit the course instance URL (e.g., `http://<host>:3000/pl/course_instance/5`) and are enrolled automatically.

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

## Exporting Student Data

All student submissions, scores, and activity are stored in PostgreSQL and persist via the `pl-db` volume.

### From the Instructor UI

Log in as admin, go to a course instance, open an assessment, and click the **Downloads** tab. Available exports:

| File | Contents |
|---|---|
| `all_submissions.csv` | Every submission attempt with answers, scores, timestamps |
| `final_submissions.csv` | Last submission per question per student |
| `best_submissions.csv` | Highest-scoring submission per question |
| `instances.csv` | Per-student assessment scores, duration |
| `instance_questions.csv` | Per-question attempts and scores |
| `scores.csv` / `points.csv` | Summary scores |

For research, `all_submissions.csv` is the most complete — it includes params, submitted answers, true answers, partial scores, and feedback for every attempt.

### From the Command Line

```sh
# Full database dump
docker exec pl-training pg_dump -U postgres postgres > pl_backup.sql

# Export a specific table to CSV
docker exec pl-training psql -U postgres -d postgres \
  -c "\copy (SELECT * FROM submissions) TO STDOUT WITH CSV HEADER" > submissions.csv

# Export assessment instances with user info
docker exec pl-training psql -U postgres -d postgres \
  -c "\copy (SELECT ai.*, u.uid, u.name FROM assessment_instances ai JOIN users u ON u.id = ai.user_id) TO STDOUT WITH CSV HEADER" > assessment_instances.csv
```

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
# Stop the container (data persists in pl-db volume)
docker stop pl-training

# Start again (reuses pl-db volume, no data loss)
docker run -d -p 3000:3000 \
  -v pl-db:/var/postgres \
  -v $HOME/tracing_questions:/course \
  -v $HOME/PrairieLearn/config.json:/PrairieLearn/config.json:ro \
  -v $HOME/.config/prairielearn/docker-config.json:/root/.config/prairielearn/config.json:ro \
  --name pl-training \
  prairielearn/prairielearn:local

# View logs
docker logs pl-training

# Check for errors
docker logs pl-training 2>&1 | grep -i error | tail -20

# Query the database
docker exec pl-training psql -U postgres -d postgres \
  -c "SELECT id, long_name FROM course_instances;"

# Backup before any destructive action
docker exec pl-training pg_dump -U postgres postgres > pl_backup.sql
```

## Cloud VM Deployment Checklist

- [ ] Clone PrairieLearn repo and build Docker image
- [ ] Clone tracing_questions course repo
- [ ] Create `~/.config/prairielearn/docker-config.json` with API key
- [ ] Launch container with `pl-db` volume for persistence
- [ ] Log in as admin, click **Load from disk**
- [ ] Test student login + self-enrollment
- [ ] Verify AI hints work
- [ ] Open firewall port 3000 (or set up reverse proxy on 80/443)
- [ ] Share course instance link with students
- [ ] After the session: export data from Downloads tab and/or `pg_dump`
