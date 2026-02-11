import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';

import { logger } from '@prairielearn/logger';
import { execute } from '@prairielearn/postgres';

import { config } from '../../../lib/config.js';
import type { Question, Submission, Variant } from '../../../lib/db-types.js';

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

  const prompt = [
    'You are a helpful teaching assistant providing feedback on a student submission.',
    `Question: ${questionText}`,
    `Student answer: ${submittedAnswer}`,
    `Correct answer: ${correctAnswer}`,
    `Score: ${scorePercent}%`,
    '',
    'Provide brief, helpful feedback to the student explaining what they got wrong and how to improve.',
    'Address the student as "you". Keep the feedback concise (2-3 sentences).',
    'If the score is 0, focus on the key concept they missed.',
  ].join('\n');

  const result = await generateText({
    model,
    prompt,
  });

  const feedbackText = result.text.trim();
  if (!feedbackText) return;

  const feedbackJson = JSON.stringify({ manual: feedbackText });

  await execute(
    'UPDATE grading_jobs SET feedback = $feedback::jsonb WHERE id = $grading_job_id',
    { feedback: feedbackJson, grading_job_id },
  );
  await execute(
    'UPDATE submissions SET feedback = $feedback::jsonb WHERE id = $submission_id',
    { feedback: feedbackJson, submission_id: submission.id },
  );
}
