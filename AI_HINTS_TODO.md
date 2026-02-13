# AI Hints: Known Limitations and TODOs

## 1. AI hints require a page refresh to appear

`generateAiFeedback()` runs as fire-and-forget in `grading.ts:477` — the grading response is sent to the student immediately, before the AI call finishes. The AI hint is written to the DB ~2-5 seconds later via raw SQL UPDATE. There is no websocket, polling, or push notification to the browser.

**Current behavior:** Student submits → sees score instantly → must manually refresh → AI hints card appears.

**Desired behavior:** AI hints appear automatically without refresh.

**Why this happens — the page lifecycle problem:**

"Save & Grade" is a traditional HTML form POST, not AJAX:
1. Student clicks "Save & Grade" → browser sends POST
2. Server runs `gradeVariant()`, kicks off `generateAiFeedback()` as fire-and-forget
3. Server responds with **302 redirect** → browser does a **full page reload** (GET)
4. New page renders with the score, but AI hints aren't in the DB yet (~2-5 sec behind)
5. The full page reload destroys any prior WebSocket/SSE/streaming connection

Any solution must work from the **new page** (after reload), since the old page is gone.

**How other AI features handle this (no refresh needed):**

| Feature | Pattern | Real-time? |
|---|---|---|
| AI grading (instructor) | Socket.IO WebSocket push → React Query invalidation | Yes |
| AI chat (editor) | Client-initiated streaming via `@ai-sdk/react` `useChat()` | Yes |

Key infrastructure files:
- `src/lib/serverJobProgressSocket.ts` — Socket.IO server namespace
- `src/components/ServerJobProgress/useServerJobProgress.ts` — client hook
- `src/ee/lib/ai-grading/ai-grading.ts` — `emitServerJobProgressUpdate()` pattern

**Three options:**

### Option A: Socket.IO (easiest, passive)
New page connects to Socket.IO, listens for "ai-hints-ready" event. Server emits after DB write. Client injects the hint card. Student sees hints appear ~2-5 sec after page loads.

- Pros: Infrastructure already exists, minimal changes
- Cons: Hints just "pop in" — no streaming effect

### Option B: Client-side polling (simplest)
New page starts polling `/api/submission/:id/feedback` every 2 sec. When `ai_hints` exists, stop polling and inject the card.

- Pros: Dead simple, no Socket.IO wiring needed
- Cons: Less elegant, slight delay from poll interval

### Option C: Client-initiated streaming (AI chat style, best UX)
New page detects "score < 100% and no hints yet", opens a streaming fetch to a new endpoint. Server calls Claude with `streamText()`, tokens flow to client word-by-word.

- Pros: Best UX (live "typing" effect), cleanest architecture (client requests what it needs)
- Cons: Most work — needs new API endpoint, hydrated React component (SubmissionPanel is currently server-rendered HTML), moves AI call from server-initiated to client-initiated

**Recommendation:** Start with Option A (Socket.IO) for quick wins. If the vision evolves toward interactive AI tutoring (student asks follow-ups), migrate to Option C later. Option A doesn't block Option C.

**Key files to change (Option A):**
- `apps/prairielearn/src/ee/lib/ai-grading/ai-feedback.ts` — emit socket event after DB write (lines 74-81)
- `apps/prairielearn/src/lib/grading.ts:477` — pass socket context to `generateAiFeedback()`
- `apps/prairielearn/src/components/SubmissionPanel.tsx` — add socket listener + spinner

**Key files to change (Option C):**
- New streaming API endpoint (tRPC or Express route)
- `apps/prairielearn/src/components/SubmissionPanel.tsx` — hydrate as React component with `useChat()` or custom streaming hook
- `apps/prairielearn/src/ee/lib/ai-grading/ai-feedback.ts` — switch from `generateText()` to `streamText()`
- `apps/prairielearn/src/lib/grading.ts:477` — remove fire-and-forget call (client initiates instead)

---

## 2. AI hints only work for internal auto-grading — NOT A CONCERN

**Status: Won't fix — not needed for our use case.**

All practice questions in the tracing_questions course (stages 1-3) use internal auto-grading. Verified 2026-02-13:

| Stage | Questions | Grading |
|---|---|---|
| Stage 1 (How to Trace) | 10 questions | All `"gradingMethod": "Internal"` |
| Stage 2 (Why to Trace) | 6 questions | Default (Internal) |
| Stage 3 (What to Trace) | 9 questions | Default (Internal) |

Pre/post tests are out of scope for AI hints (they are assessment-only, no feedback needed). No manual or external grading is used anywhere in the course.
