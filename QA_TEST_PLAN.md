# QA test plan: AI hints for students

**Issue:** [#13594](https://github.com/PrairieLearn/PrairieLearn/issues/13594)

## What this feature does

When a student submits an incorrect answer to an auto-graded question, a yellow "AI hints" card appears with a "Get AI hint" button. Hints stream in word-by-word from Claude Haiku. Students can request up to 3 hints per question and optionally describe what they need help with.

## Setup

See `SETUP_NOTES.md` for how to start PrairieLearn in Docker with an API key and enable the `ai-grading` feature flag.

## Test 1 — Wrong answer triggers hint button

1. Open a question, enter a clearly wrong answer, click **Save & Grade**
2. **Expected:** A yellow "AI hints" card appears with a **"Get AI hint"** button and a "0/3 hints used" badge
3. Click the button
4. **Expected:** Text streams in word-by-word. The hint addresses you as "you" and explains what was wrong.

## Test 2 — Correct answer hides hint card

1. Open a question, enter a fully correct answer, click **Save & Grade**
2. **Expected:** No "AI hints" card appears (score is 100%).

## Test 3 — Partially correct answer

1. Open a question, enter an answer that is partly right and partly wrong, click **Save & Grade**
2. Click **"Get AI hint"**
3. **Expected:** Feedback is specific to your actual answer, not generic.

## Test 4 — Student prompt

1. After getting an incorrect score, type a question in the text area (e.g., "Why is row 3 wrong?")
2. Click **"Get AI hint"**
3. **Expected:** The hint addresses your specific question. The prompt appears above the hint as "Your question: ..."

## Test 5 — Hint limit (3 hints)

1. Request 3 hints on the same question (across any submissions for that question)
2. **Expected:** After the 3rd hint, the button disappears and a message says "You have used all 3 available hints for this question."
3. The badge shows "3/3 hints used"

## Test 6 — Hints persist across page reloads

1. Generate a hint, then reload the page
2. **Expected:** Previously generated hints are still visible in the card. The hints-used counter is accurate.

## Quick checklist

- [ ] Wrong answer: "Get AI hint" button appears
- [ ] Correct answer: no hint card
- [ ] Partial answer: feedback is specific and relevant
- [ ] Streaming: text appears word-by-word with a spinner
- [ ] Student prompt: hint addresses the student's question
- [ ] Hint limit: button disappears after 3 hints
- [ ] Hints persist after page reload
- [ ] Feedback says "you", not "the student"
- [ ] Feedback does not reveal the correct answer directly
