# QA test plan: AI feedback for students

**Issue:** [#13594](https://github.com/PrairieLearn/PrairieLearn/issues/13594)

## What this feature does

When a student submits an answer, the AI automatically generates feedback and displays it below the submission. No instructor action needed.

## Setup

See `SETUP_NOTES.md` for how to start PrairieLearn in Docker with an API key and enable feature flags.

## Test 1 — Wrong answer

1. Open a question, enter a clearly wrong answer, click **Submit**
2. **Expected:** Feedback appears below your submission. It addresses you as "you" and explains what was wrong.

## Test 2 — Correct answer

1. Open a question, enter a fully correct answer, click **Submit**
2. **Expected:** No feedback (or a brief confirmation). The AI should not critique a correct answer.

## Test 3 — Partially correct answer

1. Open a question, enter an answer that is partly right and partly wrong, click **Submit**
2. **Expected:** Feedback mentions only what was wrong. It should be specific to your actual answer, not generic.

## Quick checklist

- [ ] Wrong answer: feedback appears below submission
- [ ] Correct answer: no feedback (or minimal)
- [ ] Partial answer: feedback is specific and relevant
- [ ] Feedback says "you", not "the student"
- [ ] Feedback does not reveal the correct answer directly
- [ ] Works on questions with a rubric
- [ ] Works on questions without a rubric
