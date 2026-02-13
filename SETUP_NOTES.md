# Local Testing Setup Notes

## Goal

Develop and test **AI hints for students** (GitHub issue #13594). When a student submits an answer to an auto-graded question and gets it partially wrong, AI (Claude Haiku) automatically generates personalized hints explaining their mistakes. The hints appear in a yellow "AI hints" card in the student's submission panel — no instructor action required.

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
4. Enable **`ai-grading-model-selection`** — required to select Claude Haiku 4.5 (the default model is OpenAI GPT 5-mini, which won't work with our Anthropic key)

## Testing AI hints (student side)

AI hints are generated automatically after auto-grading — no instructor action required.

### How to test

1. Open **TRACING 101** course → **Sp26** course instance
2. Open one of the **practice assessments**: **How to Trace** (stage 1), **Why to Trace** (stage 2), or **What to Trace** (stage 3)
3. Submit a **partially wrong** answer and click **"Save & Grade"**
4. Auto-grading runs (you'll see a score like 80%)
5. Wait a few seconds, then refresh the page
6. A yellow **"AI hints"** card appears below the submission with personalized feedback

> All practice questions (stages 1-3) are internally auto-graded — AI hints work on all of them.
> Pre/post tests are out of scope — no need to test AI hints there.
> AI hints are generated asynchronously after grading completes, so a brief wait + refresh may be needed.

### Example test question

**Question 8: "Introduction to Tracing Tables"** (`stage1_how_to_trace_01a`) — has 4 auto points. Enter a partially wrong tracing table (e.g., wrong value on one line) to trigger a partial score and see AI hints.

### Where hints are displayed

- **Student view:** Yellow "AI hints" card in the `SubmissionPanel`, rendered from `feedback.ai_hints` in the grading job
- **Instructor view:** Not directly visible — AI hints are student-facing only

## Courses available

| Course | Source |
|--------|--------|
| **TRACING 101: Code Tracing Activities and Assessments** | `/Users/ran/workspace/tracing_questions` (your course) |
| QA 101: Test Course | Built-in `testCourse` |
| XC 101: Example Course | Built-in `exampleCourse` |

## After editing course JSON files

Click **"Load from disk"** again to reload. Non-JSON changes (JS, HTML, Python) reload automatically on page refresh.

## Stop

`Ctrl+C` in the terminal running Docker, or `docker stop <container_id>`.

---

## Key code locations for AI feedback feature (#13594)

### The gap

- **Non-rubric mode:** AI generates student-facing `feedback` and stores it in `grading_jobs.feedback.manual`
- **Rubric mode:** AI only returns rubric item selections + instructor `explanation`. Feedback is stored as empty string. There is a TODO comment: `// TODO: consider asking for and recording freeform feedback.`

### Files to modify

| What | File | Lines |
|------|------|-------|
| Rubric prompt (add feedback instruction) | `src/ee/lib/ai-grading/ai-grading-util.ts` | ~115-150 |
| Rubric response schema (add `feedback` field) | `src/ee/lib/ai-grading/ai-grading.ts` | ~383-390 |
| Rubric feedback storage (replace empty string) | `src/ee/lib/ai-grading/ai-grading.ts` | ~548-550 |

### Files for reference (already working in non-rubric mode)

| What | File | Lines |
|------|------|-------|
| Non-rubric prompt (has feedback instruction) | `src/ee/lib/ai-grading/ai-grading-util.ts` | ~151-165 |
| Non-rubric response schema (has `feedback`) | `src/ee/lib/ai-grading/ai-grading.ts` | ~660-675 |
| Non-rubric feedback storage | `src/ee/lib/ai-grading/ai-grading.ts` | ~796-805 |
| Student-facing feedback display | `src/components/SubmissionPanel.tsx` | ~175 |
| Feedback markdown to HTML conversion | `src/lib/manualGrading.ts` | ~218-219 |
| Instructor-facing explanation display | `src/pages/.../instanceQuestion/instanceQuestion.ts` | ~179-220 |

### No UI changes needed

The `SubmissionPanel` already renders `feedback_manual_html` from `grading_jobs.feedback.manual`. Once feedback is generated and stored in rubric mode, it will display automatically.

---

## Deployment: Self-hosting on Google Cloud

### Overview

Deploy PrairieLearn (with AI feedback feature) on a single GCE VM. Build a custom Docker image from the `ai_feedback` branch since the stock image doesn't include our changes.

**Strategy:** Build on the VM directly — no container registry needed.

### GCP setup

1. Create a GCP project and enable Compute Engine API
2. Create a VM:
   - **Machine type:** `e2-medium` (2 vCPU, 4 GB RAM) — sufficient for ~10 users
   - **Region:** Pick one close to your users (e.g., `us-central1`)
   - **OS:** Ubuntu 22.04 LTS or Container-Optimized OS
   - **Disk:** 30 GB standard persistent disk
   - **Estimated cost:** ~$30/month (covered by $300 free trial credit)

### Build the Docker image on the VM

```bash
# SSH into the VM
gcloud compute ssh YOUR_VM_NAME

# Install Docker if not already present (Ubuntu)
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER
# Log out and back in for group change to take effect

# Clone the repo and checkout ai_feedback branch
git clone https://github.com/YOUR_USER/PrairieLearn.git
cd PrairieLearn
git checkout ai_feedback

# Build (takes 10-20 min first time)
docker build -t pl:ai-feedback .
```

### Configuration

Create `config.json` on the VM (NOT in the repo):

```json
{
  "serverCanonicalHost": "https://your-domain-or-ip",
  "cookieDomain": ".your-domain.com",
  "hasOauth": true,
  "googleClientId": "xxx",
  "googleClientSecret": "xxx",
  "googleRedirectUrl": "https://your-domain.com/pl/oauth2callback",
  "aiGradingAnthropicApiKey": "sk-ant-xxx"
}
```

> **Security:** Never commit this file. Protect with `chmod 600 config.json`.
> For extra safety, use Google Secret Manager to fetch the Anthropic key at startup.

If testing without a domain (raw IP, dev mode), you can skip OAuth and just set:

```json
{
  "aiGradingAnthropicApiKey": "sk-ant-xxx"
}
```

### Run

```bash
docker run -d --restart unless-stopped -p 3000:3000 \
  -v pl-postgres:/var/postgres \
  -v $HOME/config.json:/PrairieLearn/config.json \
  -v $HOME/tracing_questions:/course \
  --name prairielearn \
  pl:ai-feedback
```

### Post-launch setup

1. Open `http://VM_EXTERNAL_IP:3000`
2. Load course from disk
3. Enable feature flags: `ai-grading` and `ai-grading-model-selection` (Global Admin → Features)

### Security checklist

| Item | Action |
|------|--------|
| **Firewall** | GCP firewall rule: allow port 3000 only from your IP range |
| **Authentication** | `NODE_ENV=production` + Google OAuth, or restrict by IP for dev mode |
| **API key** | `config.json` with `chmod 600`, or use Secret Manager |
| **Docker image** | Built on VM, not pushed anywhere — private by default |

### Updating after code changes

```bash
cd ~/PrairieLearn
git pull origin ai_feedback
docker build -t pl:ai-feedback .
docker stop prairielearn && docker rm prairielearn
# Re-run the docker run command above
```

> **Note:** The Postgres volume (`pl-postgres`) persists across container restarts,
> so DB data (feature flags, student submissions, etc.) is preserved.
