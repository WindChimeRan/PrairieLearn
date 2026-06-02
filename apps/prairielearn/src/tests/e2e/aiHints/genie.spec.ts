import fs from 'node:fs';

import { z } from 'zod';

import * as sqldb from '@prairielearn/postgres';

import { syncCourse } from '../../helperCourse.js';

import { TRACING_COURSE_PATH, expect, test } from './fixtures.js';

const GenieIdsSchema = z.object({
  assessment_id: z.string(),
  course_instance_id: z.string(),
});

// Correct answers for question `stage1_04a` ("Function Tracing"): tracing
// `add_numbers(5, 3)` gives `answer = 8`, and the program prints `8`.
const CORRECT_ANSWER: Record<string, string> = {
  step1_x: '5',
  step1_y: '3',
  step1_a: '5',
  step1_b: '3',
  step2_x: '5',
  step2_y: '3',
  step2_a: '5',
  step2_b: '3',
  step2_result: '8',
  answer_value: '8',
  final_output: '8',
};

test('Genie returns a real hint, not {"ai_hints":null}, on a fully-correct submission', async ({
  page,
  baseURL,
}) => {
  // This test drives the live Genie against the real course, so it needs a real
  // Anthropic key and the course on disk. Skip cleanly when either is absent.
  test.skip(
    !process.env.AI_GRADING_ANTHROPIC_API_KEY || !fs.existsSync(TRACING_COURSE_PATH),
    'Requires AI_GRADING_ANTHROPIC_API_KEY and the tracing_questions course on disk',
  );
  test.setTimeout(120_000);

  // Sync the real course into the shared test DB (the server reads the same DB).
  await syncCourse(TRACING_COURSE_PATH);
  const { assessment_id, course_instance_id } = await sqldb.queryRow(
    `SELECT a.id AS assessment_id, ci.id AS course_instance_id
       FROM assessments a
       JOIN course_instances ci ON ci.id = a.course_instance_id
      WHERE a.deleted_at IS NULL AND a.tid = 'tracing_study_genie'`,
    {},
    GenieIdsSchema,
  );

  // Start the exam (self-enroll instance, honor code required).
  await page.goto(
    `${baseURL}/pl/course_instance/${course_instance_id}/assessment/${assessment_id}`,
  );
  await page.locator('#certify-pledge').check();
  await page.getByRole('button', { name: 'Start assessment' }).click();

  // Open Question 4 ("Function Tracing") and answer every field correctly.
  await page.getByRole('link', { name: 'Question 4', exact: true }).first().click();
  for (const [name, value] of Object.entries(CORRECT_ANSWER)) {
    await page.fill(`input[name="${name}"]`, value);
  }
  await page.getByRole('button', { name: /Save & Grade/i }).click();
  await page.waitForLoadState('networkidle');

  // The submission is fully correct (100%). The Genie should still appear and,
  // when asked, return a real hint — not the raw `{"ai_hints":null}` payload
  // that the buggy server short-circuit produced for `score >= 1`.
  const genie = page.locator('.card').filter({ has: page.getByText('AI hints', { exact: true }) });
  await expect(genie).toBeVisible();

  await genie
    .getByPlaceholder("What's confusing you most right now?")
    .fill('is it right this time?');
  await genie.getByRole('button', { name: /Get AI hint/i }).click();

  // Wait for the hint to finish (the "1/3 hints used" badge updates), then assert
  // the rendered hint is not the null payload.
  await expect(genie.getByText(/1\/3 hints used/)).toBeVisible({ timeout: 90_000 });
  await expect(genie).not.toContainText('{"ai_hints":null}');
});
