import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import mustache from 'mustache';

import { logger } from '@prairielearn/logger';
import { execute } from '@prairielearn/postgres';

import { config } from '../../../lib/config.js';
import type { Question, Submission, Variant } from '../../../lib/db-types.js';

const promptTemplate = fs.readFileSync(
  path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'ai-feedback.prompt'),
  'utf8',
);

/**
 * Generate AI feedback for a student submission after auto-grading.
 * This is called as a fire-and-forget operation after grading completes.
 */
export async function generateAiFeedback({
  grading_job_id,
  submission,
  variant,
  question,
  score,
}: {
  grading_job_id: string;
  submission: Submission;
  variant: Variant;
  question: Question;
  score: number | null | undefined;
}): Promise<void> {
  if (!config.aiGradingAnthropicApiKey) {
    logger.verbose('AI feedback: Anthropic API key not configured, skipping');
    return;
  }

  // No feedback needed for fully correct answers
  if (score != null && score >= 1) {
    return;
  }

  const anthropic = createAnthropic({
    apiKey: config.aiGradingAnthropicApiKey,
  });
  const model = anthropic('claude-haiku-4-5');

  const questionText = question.title ?? 'Unknown question';
  const submittedAnswer = JSON.stringify(submission.submitted_answer ?? {});
  const correctAnswer = JSON.stringify(variant.true_answer ?? {});
  const scorePercent = score != null ? Math.round(score * 100) : 'unknown';

  const prompt = mustache.render(promptTemplate, {
    questionText,
    submittedAnswer,
    correctAnswer,
    scorePercent,
  });

  const result = await generateText({
    model,
    prompt,
  });

  const feedbackText = result.text.trim();
  if (!feedbackText) return;

  const feedbackJson = JSON.stringify({ ai_hints: feedbackText });

  await execute(
    "UPDATE grading_jobs SET feedback = COALESCE(feedback, '{}'::jsonb) || $feedback::jsonb WHERE id = $grading_job_id",
    { feedback: feedbackJson, grading_job_id },
  );
  await execute(
    "UPDATE submissions SET feedback = COALESCE(feedback, '{}'::jsonb) || $feedback::jsonb WHERE id = $submission_id",
    { feedback: feedbackJson, submission_id: submission.id },
  );
}
