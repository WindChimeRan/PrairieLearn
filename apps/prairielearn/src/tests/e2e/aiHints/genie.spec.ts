import fs from 'node:fs';

import { type Page } from '@playwright/test';
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

let courseIds: z.infer<typeof GenieIdsSchema>;

/** Locator for the student-facing "AI hints" (Genie) card. */
function genieCard(page: Page) {
  return page.locator('.card').filter({ has: page.getByText('AI hints', { exact: true }) });
}

/**
 * Open Question 4 ("Function Tracing") on a *fresh* assessment instance. The
 * assessment is `multipleInstance: false`, so the first test starts a new
 * instance (honor code) and later tests regenerate to reset hint state.
 */
async function openFreshQuestion4(page: Page, baseURL: string) {
  await page.goto(
    `${baseURL}/pl/course_instance/${courseIds.course_instance_id}/assessment/${courseIds.assessment_id}`,
  );
  if (await page.locator('#certify-pledge').count()) {
    await page.locator('#certify-pledge').check();
    await page.getByRole('button', { name: 'Start assessment' }).click();
  } else {
    await page
      .getByRole('button', { name: 'Regenerate your assessment instance', exact: true })
      .click();
    await page.getByRole('button', { name: 'Regenerate assessment instance', exact: true }).click();
  }
  await page.waitForLoadState('networkidle');
  await page.getByRole('link', { name: 'Question 4', exact: true }).first().click();
  await page.waitForLoadState('networkidle');
}

async function answerQuestion4(page: Page, answers: Record<string, string>) {
  for (const [name, value] of Object.entries(answers)) {
    await page.fill(`input[name="${name}"]`, value);
  }
  await page.getByRole('button', { name: /Save & Grade/i }).click();
  await page.waitForLoadState('networkidle');
}

/** Ask the Genie one hint and wait until the "N/3 hints used" badge reaches `expectedCount`. */
async function askGenie(page: Page, prompt: string, expectedCount: number) {
  const genie = genieCard(page);
  await genie.getByPlaceholder("What's confusing you most right now?").fill(prompt);
  await genie.getByRole('button', { name: /Get AI hint/i }).click();
  await expect(genie.getByText(`${expectedCount}/3 hints used`)).toBeVisible({ timeout: 90_000 });
}

test.describe('AI hints Genie (live)', () => {
  // These tests drive the live Genie against the real course, so they need a
  // real Anthropic key and the course on disk. Skip cleanly when either is absent.
  test.skip(
    !process.env.AI_GRADING_ANTHROPIC_API_KEY || !fs.existsSync(TRACING_COURSE_PATH),
    'Requires AI_GRADING_ANTHROPIC_API_KEY and the tracing_questions course on disk',
  );

  test.beforeAll(async ({ workerPort }) => {
    void workerPort; // ensure the worker server (and DB pool) is initialized
    await syncCourse(TRACING_COURSE_PATH);
    courseIds = await sqldb.queryRow(
      `SELECT a.id AS assessment_id, ci.id AS course_instance_id
         FROM assessments a
         JOIN course_instances ci ON ci.id = a.course_instance_id
        WHERE a.deleted_at IS NULL AND a.tid = 'tracing_study_genie'`,
      {},
      GenieIdsSchema,
    );
  });

  test('returns a real hint, not {"ai_hints":null}, on a fully-correct submission', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await openFreshQuestion4(page, baseURL);
    await answerQuestion4(page, CORRECT_ANSWER);

    const genie = genieCard(page);
    await expect(genie).toBeVisible();
    await askGenie(page, 'is it right this time?', 1);
    await expect(genie).not.toContainText('{"ai_hints":null}');
  });

  test('still offers a hint on an incorrect submission', async ({ page, baseURL }) => {
    test.setTimeout(120_000);
    await openFreshQuestion4(page, baseURL);
    // Correct trace but the wrong printed output (7 instead of 8) — a partially-correct submission.
    await answerQuestion4(page, { ...CORRECT_ANSWER, final_output: '7' });

    const genie = genieCard(page);
    await expect(genie).toBeVisible();
    await askGenie(page, 'why is my output wrong?', 1);
    await expect(genie).not.toContainText('{"ai_hints":null}');
    await expect(genie.getByText('Hint 1')).toBeVisible();
  });

  test('allows up to 3 hints and blocks the 4th', async ({ page, baseURL }) => {
    test.setTimeout(200_000);
    await openFreshQuestion4(page, baseURL);
    await answerQuestion4(page, CORRECT_ANSWER);

    const genie = genieCard(page);
    await expect(genie).toBeVisible();
    await askGenie(page, 'first hint please', 1);
    await askGenie(page, 'second hint please', 2);
    await askGenie(page, 'third hint please', 3);

    // After 3 hints the limit is reached: no more input/button, just the message.
    await expect(genie.getByText('3/3 hints used')).toBeVisible();
    await expect(genie.getByRole('button', { name: /Get AI hint/i })).toHaveCount(0);
    await expect(genie).toContainText(/used all 3/i);
  });
});
