import { useCallback, useEffect, useReducer } from 'react';

type State =
  | { status: 'idle'; text: string }
  | { status: 'streaming'; text: string }
  | { status: 'done'; text: string }
  | { status: 'error'; text: string };

type Action =
  | { type: 'start' }
  | { type: 'chunk'; text: string }
  | { type: 'finish' }
  | { type: 'error' };

function reducer(_state: State, action: Action): State {
  switch (action.type) {
    case 'start':
      return { status: 'streaming', text: '' };
    case 'chunk':
      return { status: 'streaming', text: action.text };
    case 'finish':
      return { status: 'done', text: _state.text };
    case 'error':
      return { status: 'error', text: _state.text };
  }
}

export function AiHintsStreaming({
  submissionId,
  urlPrefix,
  instanceQuestionId,
  score,
  hasExistingHints,
  submissionCount,
  submissionNumber,
  expanded,
  csrfToken,
}: {
  submissionId: string;
  variantId: string;
  urlPrefix: string;
  instanceQuestionId: string;
  score: number | null;
  hasExistingHints: boolean;
  submissionCount: number;
  submissionNumber: number;
  expanded: boolean;
  csrfToken: string;
}) {
  const [state, dispatch] = useReducer(reducer, { status: 'idle', text: '' });

  const shouldStream = score != null && score < 1 && !hasExistingHints;
  const streamUrl = `${urlPrefix}/instance_question/${instanceQuestionId}/ai_hints/generate`;

  const doStream = useCallback(
    async (signal: AbortSignal) => {
      dispatch({ type: 'start' });

      const response = await fetch(streamUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({ submission_id: submissionId }),
        signal,
      });

      if (!response.ok) {
        dispatch({ type: 'error' });
        return;
      }

      const contentType = response.headers.get('content-type') ?? '';

      // If server returned JSON (hints already existed), show them directly
      if (contentType.includes('application/json')) {
        const data = await response.json();
        if (data.ai_hints) {
          dispatch({ type: 'chunk', text: data.ai_hints });
        }
        dispatch({ type: 'finish' });
        return;
      }

      // Otherwise, read the streaming text response
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
    },
    [streamUrl, csrfToken, submissionId],
  );

  useEffect(() => {
    if (!shouldStream) return;

    const abortController = new AbortController();

    doStream(abortController.signal).catch((err) => {
      if (err.name !== 'AbortError') {
        dispatch({ type: 'error' });
      }
    });

    return () => {
      abortController.abort();
    };
  }, [shouldStream, doStream]);

  if (state.status === 'idle' || state.status === 'error') return null;
  if (!state.text && state.status === 'done') return null;

  return (
    <div className="card mb-4 grading-block border-warning">
      <div
        className={`card-header bg-warning text-dark d-flex align-items-center collapsible-card-header${!expanded ? ' collapsed' : ''}`}
      >
        <div className="me-auto">
          AI hints
          {submissionCount > 1 ? ` (for submitted answer ${submissionNumber})` : ''}
        </div>
        <button
          type="button"
          className={`expand-icon-container btn btn-outline-dark btn-sm${!expanded ? ' collapsed' : ''}`}
          data-bs-toggle="collapse"
          data-bs-target={`#submission-ai-hints-streaming-${submissionId}-body`}
          aria-expanded={expanded ? 'true' : 'false'}
          aria-controls={`submission-ai-hints-streaming-${submissionId}-body`}
        >
          <i className="fa fa-angle-up ms-1 expand-icon" />
        </button>
      </div>
      <div
        className={`collapse${expanded ? ' show' : ''}`}
        id={`submission-ai-hints-streaming-${submissionId}-body`}
      >
        <div className="card-body">
          <div data-testid="ai-hints-body">
            {state.text}
            {state.status === 'streaming' && (
              <span className="ms-1">
                <span className="spinner-border spinner-border-sm" role="status">
                  <span className="visually-hidden">Loading...</span>
                </span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

AiHintsStreaming.displayName = 'AiHintsStreaming';
