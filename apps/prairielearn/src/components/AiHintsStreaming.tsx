import { useCallback, useReducer, useRef, useState } from 'react';

const MAX_HINTS = 3;

interface AiHint {
  text: string;
  student_prompt: string | null;
}

type State =
  | { status: 'idle' }
  | { status: 'streaming'; text: string }
  | { status: 'done'; text: string }
  | { status: 'error'; errorMessage: string | null };

type Action =
  | { type: 'start' }
  | { type: 'chunk'; text: string }
  | { type: 'finish' }
  | { type: 'error'; errorMessage?: string };

function reducer(_state: State, action: Action): State {
  switch (action.type) {
    case 'start':
      return { status: 'streaming', text: '' };
    case 'chunk':
      return { status: 'streaming', text: action.text };
    case 'finish':
      return { status: 'done', text: _state.status === 'streaming' ? _state.text : '' };
    case 'error':
      return { status: 'error', errorMessage: action.errorMessage ?? null };
  }
}

/**
 * Normalize the ai_hints field from feedback, which may be:
 * - a string (old format, single hint)
 * - an array of AiHint objects (new format)
 * - undefined/null
 */
function normalizeHints(raw: unknown): AiHint[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (typeof item === 'string') return { text: item, student_prompt: null };
      return { text: item.text ?? '', student_prompt: item.student_prompt ?? null };
    });
  }
  if (typeof raw === 'string') {
    return [{ text: raw, student_prompt: null }];
  }
  return [];
}

export function AiHintsStreaming({
  submissionId,
  urlPrefix,
  instanceQuestionId,
  existingHintsJson,
  hintsUsed,
  csrfToken,
}: {
  submissionId: string;
  urlPrefix: string;
  instanceQuestionId: string;
  existingHintsJson: string;
  hintsUsed: number;
  csrfToken: string;
}) {
  const parsed = JSON.parse(existingHintsJson) as unknown;
  const initialHints = normalizeHints(parsed);

  const [hints, setHints] = useState<AiHint[]>(initialHints);
  const [localHintsUsed, setLocalHintsUsed] = useState(hintsUsed);
  const [studentPrompt, setStudentPrompt] = useState('');
  const [state, dispatch] = useReducer(reducer, { status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  const streamUrl = `${urlPrefix}/instance_question/${instanceQuestionId}/ai_hints/generate`;
  const isStreaming = state.status === 'streaming';
  const limitReached = localHintsUsed >= MAX_HINTS;

  const doStream = useCallback(
    async (prompt: string) => {
      abortRef.current?.abort();
      const abortController = new AbortController();
      abortRef.current = abortController;

      dispatch({ type: 'start' });

      try {
        const response = await fetch(streamUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify({
            submission_id: submissionId,
            student_prompt: prompt || undefined,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          if (response.status === 429) {
            const data = await response.json();
            setLocalHintsUsed(data.hints_used ?? MAX_HINTS);
            dispatch({ type: 'error', errorMessage: 'Hint limit reached.' });
            return;
          }
          dispatch({ type: 'error' });
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          dispatch({ type: 'error' });
          return;
        }

        const decoder = new TextDecoder();
        let accumulated = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          dispatch({ type: 'chunk', text: accumulated });
        }

        dispatch({ type: 'finish' });

        const newHint: AiHint = {
          text: accumulated.trim(),
          student_prompt: prompt || null,
        };
        setHints((prev) => [...prev, newHint]);
        setLocalHintsUsed((prev) => prev + 1);
        setStudentPrompt('');
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        dispatch({ type: 'error' });
      }
    },
    [streamUrl, csrfToken, submissionId],
  );

  const handleGetHint = () => {
    void doStream(studentPrompt);
  };

  return (
    <div className="card mb-4 grading-block border-warning">
      <div className="card-header bg-warning text-dark d-flex align-items-center">
        <div className="me-auto fw-bold">AI hints</div>
        <span className="badge bg-dark">
          {localHintsUsed}/{MAX_HINTS} hints used
        </span>
      </div>
      <div className="card-body">
        {/* Hints are append-only and never reorder, so index keys are safe */}
        {hints.map((hint, idx) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key
          <div key={idx} className="mb-3">
            <div className="d-flex align-items-center mb-1">
              <strong className="text-muted">Hint {idx + 1}</strong>
            </div>
            {hint.student_prompt ? (
              <div className="mb-1 fst-italic text-muted small">
                Your question: {hint.student_prompt}
              </div>
            ) : null}
            <div className="ps-2 border-start border-warning border-3">{hint.text}</div>
          </div>
        ))}

        {state.status === 'streaming' ? (
          <div className="mb-3">
            <div className="d-flex align-items-center mb-1">
              <strong className="text-muted">Hint {hints.length + 1}</strong>
            </div>
            {studentPrompt ? (
              <div className="mb-1 fst-italic text-muted small">Your question: {studentPrompt}</div>
            ) : null}
            <div className="ps-2 border-start border-warning border-3">
              {state.text}
              <span className="ms-1">
                <span className="spinner-border spinner-border-sm" role="status">
                  <span className="visually-hidden">Loading...</span>
                </span>
              </span>
            </div>
          </div>
        ) : null}

        {state.status === 'error' ? (
          <div className="alert alert-danger mb-3" role="alert">
            {state.errorMessage ?? 'Failed to generate hint. Please try again.'}
          </div>
        ) : null}

        {!limitReached ? (
          <div>
            <textarea
              className="form-control mb-2"
              rows={2}
              placeholder="Optionally describe what you need help with..."
              value={studentPrompt}
              disabled={isStreaming}
              onChange={(e) => setStudentPrompt(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-warning"
              disabled={isStreaming}
              onClick={handleGetHint}
            >
              {isStreaming ? (
                <>
                  <span
                    className="spinner-border spinner-border-sm me-1"
                    role="status"
                    aria-hidden="true"
                  />
                  Generating...
                </>
              ) : (
                <>
                  <i className="fas fa-lightbulb me-1" />
                  Get AI hint
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="text-muted small">
            You have used all {MAX_HINTS} available hints for this question.
          </div>
        )}
      </div>
    </div>
  );
}

AiHintsStreaming.displayName = 'AiHintsStreaming';
