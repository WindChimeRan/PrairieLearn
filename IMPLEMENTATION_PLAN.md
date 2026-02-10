# Implementation plan: AI feedback for students

**Issue:** [#13594](https://github.com/PrairieLearn/PrairieLearn/issues/13594) | **Branch:** `ai_feedback`

## Goal

When a student submits an answer, the AI automatically generates feedback and displays it below the submission. No instructor action needed.

## How the student submission flow works today

```
Student clicks "Save & Grade"
  → processSubmission()          (question-submission.ts)
  → saveAndGradeSubmission()     (grading.ts)
  → saveSubmission()             saves to DB
  → gradeVariant()               auto-grades the submission
    → questionModule.grade()     returns score + grading data
    → updateGradingJobAfterGrading()  saves results to DB
  → response sent to student
```

AI feedback does not exist in this flow today. The existing AI grading is a separate, instructor-triggered path.

## Changes

### 1. Hook into `gradeVariant()` to trigger AI feedback

**File:** `apps/prairielearn/src/lib/grading.ts` ~line 452

After `updateGradingJobAfterGrading()` completes (grading results are saved, we have the score), fire off an async AI feedback call. This should:

- Check the `ai-grading` feature flag is enabled
- Call a new function to generate AI feedback (see step 2)
- Run asynchronously — don't block the student's response
- The student sees feedback on page refresh

### 2. Create an AI feedback function

**File:** `apps/prairielearn/src/ee/lib/ai-grading/` (new file or extend existing)

A function that:

- Takes the submission, variant (has correct answer), question, and grading result (score)
- Constructs a prompt asking the AI to generate student-facing feedback
- Calls the LLM (reuse existing model/provider infrastructure from `ai-grading.ts`)
- Stores the feedback in `grading_jobs.feedback` (same field the UI already reads from)

The prompt should work for both rubric and non-rubric questions. It just needs:
- The question text
- The student's answer
- The correct answer
- The score
- Rubric items (if any)

### 3. Fix rubric mode feedback in existing instructor flow

These 3 edits fix the existing instructor-triggered AI grading so it also produces student feedback in rubric mode:

**a.** `ai-grading-util.ts` ~line 125 — Add feedback instruction to the rubric prompt:
```
'Include brief feedback for the student on their submission. Address the student as "you". Use an empty string if the student\'s response is entirely correct.',
```

**b.** `ai-grading.ts` ~line 383 — Add `feedback` field to `RubricGradingResultSchema` (before `rubric_items`):
```typescript
feedback: z.string().describe(
  'Student-facing feedback on their submission. Address the student as "you". Use an empty string if the student\'s response is entirely correct.',
),
```

**c.** `ai-grading.ts` ~line 548 — Replace `feedback: { manual: '' }` with `feedback: { manual: finalGradingResponse.object.feedback }`.

## UI

No UI changes needed. The `SubmissionPanel` already renders `feedback_manual_html` from `grading_jobs.feedback.manual`. The student will see feedback on page refresh after the async AI call completes.

## Summary

| Change | File | What |
|--------|------|------|
| Hook into student submission | `grading.ts` | Trigger AI feedback after grading |
| AI feedback function | `ai-grading/` (new or extended) | Prompt + LLM call + store feedback |
| Fix rubric prompt | `ai-grading-util.ts` | Add feedback instruction |
| Fix rubric schema | `ai-grading.ts` | Add `feedback` field |
| Fix rubric storage | `ai-grading.ts` | Store feedback instead of empty string |
