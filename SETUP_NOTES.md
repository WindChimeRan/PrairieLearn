# Local Testing Setup Notes

## Goal

Develop and test **AI hints for students** (GitHub issue #13594). When a student submits an incorrect answer to an auto-graded question, a yellow "AI hints" card appears with a **"Get AI hint"** button. The student clicks the button, and a hint streams in word-by-word from Claude Haiku. Students can request up to 3 hints per question and optionally describe what they need help with.

## Prerequisites

- Docker Desktop running (v4.60+ / Engine 29+ required for `COPY --parents` in Dockerfile)
- Anthropic API key in `~/.config/prairielearn/docker-config.json` (edit the placeholder)

## Build the custom Docker image

We build from the `ai_feedback` branch since the stock `prairielearn/prairielearn` image doesn't include our changes.

```bash
# From the PrairieLearn repo root, on ai_feedback branch
docker build -t pl:ai-feedback .
```

> First build takes 10-20 min. Subsequent builds are faster due to layer caching.
> Rebuild after pulling new changes on the branch.

## Start PrairieLearn with tracing_questions course

```bash
docker run --rm -p 3007:3000 \
  -v /Users/ran/workspace/tracing_questions:/course \
  -v /Users/ran/.config/prairielearn/docker-config.json:/PrairieLearn/config.json \
  pl:ai-feedback
```

> Port 3000 is often occupied by the native dev server, so we map to **3007**.

## Access

- URL: **http://localhost:3007**
- Login: Dev User (automatic in development mode)

## First-time setup after container starts

1. Click **"Load from disk"** (green button, top-right corner)
2. Wait for sync to complete — look for "Course sync successful" for `/course`
3. Navigate back to **Home**

## Enable feature flags

Feature flags are stored in the DB, which is ephemeral. Re-enable after every container restart.

1. Click **"Global Admin"** in the top nav bar
2. Go to **Features**
3. Enable **`ai-grading`** — add a grant (enable globally)

> The `ai-grading-model-selection` flag is only needed for instructor-side AI grading. Student-side AI hints hardcode Claude Opus 4.6 and don't require it.

## Testing AI hints (student side)

### How to test

1. Open **TRACING 101** course -> **Sp26** course instance
2. Open one of the **practice assessments**: **How to Trace** (stage 1), **Why to Trace** (stage 2), or **What to Trace** (stage 3)
3. Submit a **partially wrong** answer and click **"Save & Grade"**
4. Auto-grading runs (you'll see a score like 80%)
5. A yellow **"AI hints"** card appears below the submission with a **"Get AI hint"** button
6. Click the button — a hint streams in word-by-word
7. Optionally type a question in the text area before clicking (e.g., "Why is row 3 wrong?")
8. Request up to 3 hints — the badge shows **"N/3 hints used"**

> All practice questions (stages 1-3) are internally auto-graded — AI hints work on all of them.
> Pre/post tests are out of scope — no need to test AI hints there.
> AI hints only appear for submissions with score < 100%.

### Example test question

**Question 8: "Introduction to Tracing Tables"** (`stage1_how_to_trace_01a`) — has 4 auto points. Enter a partially wrong tracing table (e.g., wrong value on one line) to trigger a partial score and see AI hints.

### Where hints are displayed

- **Student view:** Yellow "AI hints" card (hydrated React component) in the submission panel
- **Instructor view:** Not directly visible — AI hints are student-facing only

## Courses available

| Course                                                   | Source                                                 |
| -------------------------------------------------------- | ------------------------------------------------------ |
| **TRACING 101: Code Tracing Activities and Assessments** | `/Users/ran/workspace/tracing_questions` (your course) |
| QA 101: Test Course                                      | Built-in `testCourse`                                  |
| XC 101: Example Course                                   | Built-in `exampleCourse`                               |

## After editing course JSON files

Click **"Load from disk"** again to reload. Non-JSON changes (JS, HTML, Python) reload automatically on page refresh.

## Stop

`Ctrl+C` in the terminal running Docker, or `docker stop <container_id>`.

---

## Deployment: Self-hosting on Google Cloud

### Overview

Deploy PrairieLearn (with AI hints feature) on a single GCE VM. The Docker image is built locally (the VM has limited RAM) and pushed to Docker Hub, then pulled on the VM.

### User-facing URLs

- Register new account: http://34.45.24.21:3000/pl/login
- Register the course: http://34.45.24.21:3000/pl/course_instance/8/assessments
- Students need to login, then use the direct link (auto-course-signin)

### Cloud SSH

```bash
gcloud compute ssh --project=gen-lang-client-0781214169 --zone=us-central1-c pl-ai-hint
```

### Build and push (from local machine)

```bash
# From the PrairieLearn repo root, on ai_feedback branch
docker build --platform linux/amd64 -t haoranz6/prairielearn:local .
docker push haoranz6/prairielearn:local
```

### Deploy on GCP VM

```bash
# On the VM — login to Docker Hub once
docker login

# Pull and restart
docker stop pl-training && docker rm pl-training
docker pull haoranz6/prairielearn:local
docker run -d --restart unless-stopped -p 3000:3000 \
  -v pl-postgres:/var/postgres \
  -v $HOME/config.json:/PrairieLearn/config.json \
  -v $HOME/tracing_questions:/course \
  --name pl-training \
  haoranz6/prairielearn:local
```

### Configuration

Create `config.json` on the VM (NOT in the repo):

```json
{
  "aiGradingAnthropicApiKey": "sk-ant-xxx"
}
```

> **Security:** Never commit this file. Protect with `chmod 600 config.json`.

### Post-launch setup

1. Open http://34.45.24.21:3000
2. Load course from disk
3. Enable feature flag: `ai-grading` (Global Admin -> Features)

### Security checklist

| Item               | Action                                                               |
| ------------------ | -------------------------------------------------------------------- |
| **Firewall**       | GCP firewall rule: allow port 3000 only from your IP range           |
| **Authentication** | Dev mode for student testing, or `NODE_ENV=production` + Google OAuth |
| **API key**        | `config.json` with `chmod 600`, or use Secret Manager                |
| **Docker image**   | Pushed to `haoranz6/prairielearn:local` on Docker Hub                |

> **Note:** The Postgres volume (`pl-postgres`) persists across container restarts,
> so DB data (feature flags, student submissions, etc.) is preserved.
