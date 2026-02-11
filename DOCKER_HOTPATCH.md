# Hot-patching code changes into a running PrairieLearn Docker container

## Why

The official `prairielearn/prairielearn` Docker image ships with pre-compiled JavaScript in `/PrairieLearn/apps/prairielearn/dist/`. When you edit TypeScript source files locally, the running container doesn't pick them up. Rebuilding the entire image is slow. This workflow lets you inject compiled changes in ~2 minutes.

## Prerequisites

- Docker Desktop running
- Local repo has `node_modules` installed (`yarn install`)
- A PrairieLearn container running (see `SETUP_NOTES.md`)

## Steps

### 1. Build locally

From the repo root:

```bash
make build
```

This compiles all TypeScript to JavaScript in `apps/prairielearn/dist/`. Takes ~2 minutes.

### 2. Start the container (if not already running)

```bash
docker run -d --name pl-test -p 3007:3000 \
  -v /Users/ran/workspace/tracing_questions:/course \
  -v /Users/ran/.config/prairielearn/docker-config.json:/PrairieLearn/config.json \
  prairielearn/prairielearn
```

> Use `-d` (detached) and `--name pl-test` so we can reference it later. Do NOT use `--rm` — we need the container to survive a restart.

### 3. Wait for healthy

```bash
docker inspect --format='{{.State.Health.Status}}' pl-test
```

Repeat until it says `healthy` (~90 seconds).

### 4. Copy compiled files into the container

For each modified file, copy the compiled `.js` and `.js.map` from your local `dist/` into the container's `dist/`:

```bash
# Example: copy a modified file
docker cp apps/prairielearn/dist/lib/grading.js \
  pl-test:/PrairieLearn/apps/prairielearn/dist/lib/

docker cp apps/prairielearn/dist/lib/grading.js.map \
  pl-test:/PrairieLearn/apps/prairielearn/dist/lib/

# Example: copy a new file
docker cp apps/prairielearn/dist/ee/lib/ai-grading/ai-feedback.js \
  pl-test:/PrairieLearn/apps/prairielearn/dist/ee/lib/ai-grading/

docker cp apps/prairielearn/dist/ee/lib/ai-grading/ai-feedback.js.map \
  pl-test:/PrairieLearn/apps/prairielearn/dist/ee/lib/ai-grading/
```

### 5. Restart the container

```bash
docker restart pl-test
```

This restarts all processes inside the container (Postgres, Redis, S3, PrairieLearn) with the new code. Takes ~90 seconds to become healthy again.

### 6. Re-enable feature flags

The DB is ephemeral inside Docker. After a restart, feature flags reset. Re-enable them:

1. Go to http://localhost:3007
2. Click **Load from disk** (re-syncs courses)
3. Go to **Global Admin** → **Features**
4. Grant **`ai-grading`** and **`ai-grading-model-selection`** globally

## Quick one-liner for the AI feedback files

```bash
# Build, copy all 4 changed files, restart
make build && \
docker cp apps/prairielearn/dist/ee/lib/ai-grading/ai-feedback.js pl-test:/PrairieLearn/apps/prairielearn/dist/ee/lib/ai-grading/ && \
docker cp apps/prairielearn/dist/ee/lib/ai-grading/ai-feedback.js.map pl-test:/PrairieLearn/apps/prairielearn/dist/ee/lib/ai-grading/ && \
docker cp apps/prairielearn/dist/ee/lib/ai-grading/ai-grading.js pl-test:/PrairieLearn/apps/prairielearn/dist/ee/lib/ai-grading/ && \
docker cp apps/prairielearn/dist/ee/lib/ai-grading/ai-grading.js.map pl-test:/PrairieLearn/apps/prairielearn/dist/ee/lib/ai-grading/ && \
docker cp apps/prairielearn/dist/ee/lib/ai-grading/ai-grading-util.js pl-test:/PrairieLearn/apps/prairielearn/dist/ee/lib/ai-grading/ && \
docker cp apps/prairielearn/dist/ee/lib/ai-grading/ai-grading-util.js.map pl-test:/PrairieLearn/apps/prairielearn/dist/ee/lib/ai-grading/ && \
docker cp apps/prairielearn/dist/lib/grading.js pl-test:/PrairieLearn/apps/prairielearn/dist/lib/ && \
docker cp apps/prairielearn/dist/lib/grading.js.map pl-test:/PrairieLearn/apps/prairielearn/dist/lib/ && \
docker restart pl-test && \
echo "Done — wait ~90s for healthy"
```

## Gotchas

- **Don't use `--rm`** when starting the container. If you do, `docker restart` won't work (the container gets deleted on stop).
- **Don't kill PID 1** inside the container. That stops the entire container. Use `docker restart` instead.
- **Source maps**: Always copy both `.js` and `.js.map` files so stack traces point to the right TypeScript lines.
- **New files**: `docker cp` creates them automatically — no need to mkdir first.
- **DB is ephemeral**: Feature flags, student enrollments, and submissions all reset on container restart.
