# Local Testing Setup Notes

## Goal

Develop and test the **AI feedback feature** (GitHub issue #13594): adding natural language feedback to students when AI grading uses a rubric. Currently, feedback is only generated in non-rubric mode.

## Prerequisites

- Docker Desktop running
- Anthropic API key in `~/.config/prairielearn/docker-config.json` (edit the placeholder)

## Start PrairieLearn with tracing_questions course

```bash
docker run --rm -p 3007:3000 \
  -v /Users/ran/workspace/tracing_questions:/course \
  -v /Users/ran/.config/prairielearn/docker-config.json:/PrairieLearn/config.json \
  prairielearn/prairielearn
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

## Testing AI grading feedback

### Model

We use **Anthropic Claude Haiku 4.5** (`claude-haiku-4-5`). Select it from the model dropdown after enabling `ai-grading-model-selection`.

### Where to trigger AI grading

1. Open **TRACING 101** course
2. Go to a course instance → an assessment that uses manual grading
3. Navigate to **Manual Grading** → pick an assessment question
4. Toggle **"AI grading mode"** on
5. Select the **Claude Haiku 4.5** model
6. Select submissions and click the AI grade button

> The question must have `max_manual_points` set (i.e., uses manual grading, not autograding).

### Where feedback is displayed

- **Instructor view:** Manual Grading → Instance Question page shows the AI's `explanation` (instructor-facing)
- **Student view:** The `SubmissionPanel` renders `feedback_manual_html` below the submission

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
