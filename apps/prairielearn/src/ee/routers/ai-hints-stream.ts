import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';

import { HttpStatusError } from '@prairielearn/error';
import { loadSqlEquiv, queryOptionalRow } from '@prairielearn/postgres';

import { config } from '../../lib/config.js';
import {
  GradingJobSchema,
  QuestionSchema,
  SubmissionSchema,
  VariantSchema,
} from '../../lib/db-types.js';
import { features } from '../../lib/features/index.js';
import { streamAiFeedback } from '../lib/ai-grading/ai-feedback-stream.js';

const sql = loadSqlEquiv(import.meta.url);

const SubmissionForAiHintsSchema = z.object({
  id: SubmissionSchema.shape.id,
  variant_id: SubmissionSchema.shape.variant_id,
  score: SubmissionSchema.shape.score,
  feedback: SubmissionSchema.shape.feedback,
  submitted_answer: SubmissionSchema.shape.submitted_answer,
  true_answer: VariantSchema.shape.true_answer,
  question_id: VariantSchema.shape.question_id,
  grading_job_id: GradingJobSchema.shape.id,
});

const router = Router({ mergeParams: true });

router.post(
  '/generate',
  asyncHandler(async (req, res) => {
    const aiGradingEnabled = await features.enabled('ai-grading', {
      institution_id: res.locals.course.institution_id,
      course_id: res.locals.course.id,
    });
    if (!aiGradingEnabled) {
      throw new HttpStatusError(403, 'AI grading feature is not enabled');
    }

    if (!config.aiGradingAnthropicApiKey) {
      throw new HttpStatusError(503, 'AI grading API key not configured');
    }

    const submissionId = req.body.submission_id;
    if (!submissionId) {
      throw new HttpStatusError(400, 'Missing submission_id');
    }

    const row = await queryOptionalRow(
      sql.select_submission_for_ai_hints,
      {
        submission_id: submissionId,
        instance_question_id: res.locals.instance_question.id,
      },
      SubmissionForAiHintsSchema,
    );

    if (!row) {
      throw new HttpStatusError(404, 'Submission not found');
    }

    // If hints already exist, return them as JSON
    if (row.feedback?.ai_hints) {
      res.json({ ai_hints: row.feedback.ai_hints });
      return;
    }

    // Only generate hints for incorrect answers
    if (row.score != null && row.score >= 1) {
      res.json({ ai_hints: null });
      return;
    }

    // Look up the question for the prompt
    const question = await queryOptionalRow(
      'SELECT * FROM questions WHERE id = $question_id',
      { question_id: row.question_id },
      QuestionSchema,
    );
    if (!question) {
      throw new HttpStatusError(404, 'Question not found');
    }

    // Build a minimal variant object for the stream function
    const variant = { true_answer: row.true_answer } as any;
    const submission = {
      id: row.id,
      submitted_answer: row.submitted_answer,
    } as any;

    const result = streamAiFeedback({
      grading_job_id: row.grading_job_id,
      submission,
      variant,
      question,
      score: row.score,
    });

    result.pipeTextStreamToResponse(res);
  }),
);

export default router;
