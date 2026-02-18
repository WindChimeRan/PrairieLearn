import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import mustache from 'mustache';

import { logger } from '@prairielearn/logger';
import { execute } from '@prairielearn/postgres';

import { config } from '../../../lib/config.js';
import type { Submission } from '../../../lib/db-types.js';

const promptTemplate = fs.readFileSync(
  path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'ai-feedback.prompt'),
  'utf8',
);

/**
 * Stream AI feedback for a student submission after auto-grading.
 * Returns the streamText result so the caller can pipe the text stream to the response.
 */
export function streamAiFeedback({
  grading_job_id,
  submission,
  questionHtml,
  answerHtml,
  score,
  studentPrompt,
}: {
  grading_job_id: string;
  submission: Submission;
  questionHtml: string;
  answerHtml: string;
  score: number | null | undefined;
  studentPrompt?: string;
}) {
  const anthropic = createAnthropic({
    apiKey: config.aiGradingAnthropicApiKey!,
  });
  const model = anthropic('claude-haiku-4-5');

  const questionText = questionHtml;
  const submittedAnswer = JSON.stringify(submission.submitted_answer ?? {});
  const correctAnswer = answerHtml;
  const scorePercent = score != null ? Math.round(score * 100) : 'unknown';

  const prompt = mustache.render(promptTemplate, {
    questionText,
    submittedAnswer,
    correctAnswer,
    scorePercent,
    studentPrompt: studentPrompt || null,
  });

  return streamText({
    model,
    prompt,
    onFinish: async ({ text }) => {
      const feedbackText = text.trim();
      if (!feedbackText) return;

      const newHint = JSON.stringify({
        text: feedbackText,
        student_prompt: studentPrompt ?? null,
        prompt,
      });

      try {
        await execute(
          `UPDATE grading_jobs SET feedback = jsonb_set(
            COALESCE(feedback, '{}'::jsonb),
            '{ai_hints}',
            COALESCE(
              CASE WHEN jsonb_typeof(feedback->'ai_hints') = 'array' THEN feedback->'ai_hints' ELSE '[]'::jsonb END,
              '[]'::jsonb
            ) || $new_hint::jsonb
          ) WHERE id = $grading_job_id`,
          { new_hint: `[${newHint}]`, grading_job_id },
        );
        await execute(
          `UPDATE submissions SET feedback = jsonb_set(
            COALESCE(feedback, '{}'::jsonb),
            '{ai_hints}',
            COALESCE(
              CASE WHEN jsonb_typeof(feedback->'ai_hints') = 'array' THEN feedback->'ai_hints' ELSE '[]'::jsonb END,
              '[]'::jsonb
            ) || $new_hint::jsonb
          ) WHERE id = $submission_id`,
          { new_hint: `[${newHint}]`, submission_id: submission.id },
        );
      } catch (err) {
        logger.error('Failed to save streamed AI feedback to DB', err);
      }
    },
  });
}
