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

interface ConversationTurn {
  wish_number: number;
  student_question: string | null;
  oracle_response: string;
  submission_number: number;
}

/**
 * Stream AI feedback for a student submission after auto-grading.
 * Returns the streamText result so the caller can pipe the text stream to the response.
 */
export function streamAiFeedback({
  grading_job_id,
  submission,
  questionHtml,
  trueAnswer,
  partialScores,
  studentPrompt,
  questionName,
  wishNumber,
  previousStudentAnswer,
  previousGradingResult,
  conversationHistory,
}: {
  grading_job_id: string;
  submission: Submission;
  questionHtml: string;
  trueAnswer: Record<string, any> | null;
  partialScores: Record<string, any> | null;
  studentPrompt?: string;
  questionName?: string;
  wishNumber: number;
  previousStudentAnswer: Record<string, any> | null;
  previousGradingResult: Record<string, any> | null;
  conversationHistory: ConversationTurn[];
}) {
  const anthropic = createAnthropic({
    apiKey: config.aiGradingAnthropicApiKey!,
  });
  const model = anthropic('claude-opus-4-8');

  const hasPreviousSubmission = previousStudentAnswer != null;
  const hasHistory = conversationHistory.length > 0;
  const isFinalHint = wishNumber >= 3;

  const prompt = mustache.render(promptTemplate, {
    questions: [
      {
        answersName: questionName ?? 'Question',
        questionText: questionHtml,
        submittedAnswer: JSON.stringify(submission.submitted_answer ?? {}),
        trueAnswer: JSON.stringify(trueAnswer ?? {}),
        partialScores: JSON.stringify(partialScores ?? {}),
      },
    ],
    studentPrompt: studentPrompt || null,
    wishNumber,
    hasHistory,
    conversationHistory,
    hasPreviousSubmission,
    previousStudentAnswer: hasPreviousSubmission ? JSON.stringify(previousStudentAnswer) : null,
    previousGradingResult: hasPreviousSubmission
      ? JSON.stringify(previousGradingResult ?? {})
      : null,
    isFinalHint,
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
