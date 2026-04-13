import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';

import { HttpStatusError } from '@prairielearn/error';
import { loadSqlEquiv, queryOptionalRow, queryRow, queryRows } from '@prairielearn/postgres';

import { config } from '../../lib/config.js';
import {
  GradingJobSchema,
  QuestionSchema,
  SubmissionSchema,
  VariantSchema,
} from '../../lib/db-types.js';
import { features } from '../../lib/features/index.js';
import { buildQuestionUrls } from '../../lib/question-render.js';
import { getQuestionCourse } from '../../lib/question-variant.js';
import * as questionServers from '../../question-servers/index.js';
import { streamAiFeedback } from '../lib/ai-grading/ai-feedback-stream.js';
import { stripHtmlForAiGrading } from '../lib/ai-grading/ai-grading-render.js';

const sql = loadSqlEquiv(import.meta.url);

const MAX_HINTS = 3;

const SubmissionForAiHintsSchema = z.object({
  id: SubmissionSchema.shape.id,
  variant_id: SubmissionSchema.shape.variant_id,
  score: SubmissionSchema.shape.score,
  feedback: SubmissionSchema.shape.feedback,
  partial_scores: SubmissionSchema.shape.partial_scores,
  submitted_answer: SubmissionSchema.shape.submitted_answer,
  true_answer: VariantSchema.shape.true_answer,
  question_id: VariantSchema.shape.question_id,
  grading_job_id: GradingJobSchema.shape.id,
});

const HistoryRowForAiHintsSchema = z.object({
  id: SubmissionSchema.shape.id,
  submitted_answer: SubmissionSchema.shape.submitted_answer,
  partial_scores: SubmissionSchema.shape.partial_scores,
  ai_hints: z.unknown(),
});

interface ConversationTurn {
  wish_number: number;
  student_question: string | null;
  oracle_response: string;
  submission_number: number;
}

interface HistoryContext {
  wishNumber: number;
  previousStudentAnswer: Record<string, any> | null;
  previousGradingResult: Record<string, any> | null;
  conversationHistory: ConversationTurn[];
}

function normalizeStoredHints(
  raw: unknown,
): { text: string; student_prompt: string | null }[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    const result: { text: string; student_prompt: string | null }[] = [];
    for (const item of raw) {
      if (typeof item === 'string') {
        if (item) result.push({ text: item, student_prompt: null });
      } else if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const text = typeof obj.text === 'string' ? obj.text : '';
        const studentPrompt = typeof obj.student_prompt === 'string' ? obj.student_prompt : null;
        if (text) result.push({ text, student_prompt: studentPrompt });
      }
    }
    return result;
  }
  if (typeof raw === 'string') {
    return raw ? [{ text: raw, student_prompt: null }] : [];
  }
  return [];
}

function buildHistoryContext(
  rows: z.infer<typeof HistoryRowForAiHintsSchema>[],
  currentSubmissionId: string,
): HistoryContext {
  const conversationHistory: ConversationTurn[] = [];
  let wishCounter = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const submissionNumber = i + 1;
    const hints = normalizeStoredHints(row.ai_hints);
    for (const hint of hints) {
      wishCounter += 1;
      conversationHistory.push({
        wish_number: wishCounter,
        student_question: hint.student_prompt,
        oracle_response: hint.text,
        submission_number: submissionNumber,
      });
    }
  }

  const currentIndex = rows.findIndex((r) => r.id === currentSubmissionId);
  const previousRow = currentIndex > 0 ? rows[currentIndex - 1] : null;

  return {
    wishNumber: wishCounter + 1,
    previousStudentAnswer: previousRow?.submitted_answer ?? null,
    previousGradingResult: previousRow?.partial_scores ?? null,
    conversationHistory,
  };
}

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

    const studentPrompt: string | undefined = req.body.student_prompt || undefined;

    // Enforce hint limit
    const hintCount = await queryRow(
      sql.count_ai_hints_for_instance_question,
      { instance_question_id: res.locals.instance_question.id },
      z.number(),
    );

    if (hintCount >= MAX_HINTS) {
      res.status(429).json({ error: 'Hint limit reached', hints_used: hintCount });
      return;
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

    // Fetch the full variant for rendering
    const variant = await queryRow(
      sql.select_variant_for_ai_hints,
      { variant_id: row.variant_id },
      VariantSchema,
    );

    // Render question HTML and strip it for the LLM prompt
    const question_course = await getQuestionCourse(question, res.locals.course);
    const locals = {
      ...buildQuestionUrls(res.locals.urlPrefix, variant, question, res.locals.instance_question),
      questionRenderContext: 'ai_grading',
    };
    const questionModule = questionServers.getModule(question.type);
    const renderResult = await questionModule.render(
      { question: true, submissions: false, answer: false },
      variant,
      question,
      null,
      [],
      question_course,
      locals,
    );
    const questionHtml = await stripHtmlForAiGrading(renderResult.data.questionHtml);

    const submission = {
      id: row.id,
      submitted_answer: row.submitted_answer,
    } as any;

    const historyRows = await queryRows(
      sql.select_history_for_ai_hints,
      { instance_question_id: res.locals.instance_question.id },
      HistoryRowForAiHintsSchema,
    );
    const historyContext = buildHistoryContext(historyRows, submissionId);

    const result = streamAiFeedback({
      grading_job_id: row.grading_job_id,
      submission,
      questionHtml,
      trueAnswer: row.true_answer,
      partialScores: row.partial_scores,
      studentPrompt,
      questionName: question.qid ?? question.title ?? undefined,
      wishNumber: historyContext.wishNumber,
      previousStudentAnswer: historyContext.previousStudentAnswer,
      previousGradingResult: historyContext.previousGradingResult,
      conversationHistory: historyContext.conversationHistory,
    });

    result.pipeTextStreamToResponse(res);
  }),
);

export default router;
