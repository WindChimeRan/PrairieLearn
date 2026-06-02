/* eslint-disable react-hooks/rules-of-hooks */
import { test as base } from '@playwright/test';

import { setupWorkerServer } from '../serverUtils.js';

export { expect } from '@playwright/test';

/**
 * Path to the real `tracing_questions` course served by the e2e server. This is
 * the course that hosts the AI-hints ("Genie") feature, so the e2e test runs
 * against the same content as production. Override with `TRACING_COURSE_PATH`.
 */
export const TRACING_COURSE_PATH =
  process.env.TRACING_COURSE_PATH ?? '/Users/ran/workspace/tracing_questions';

interface WorkerFixtures {
  workerPort: number;
}

interface TestFixtures {
  baseURL: string;
}

/**
 * e2e fixture that serves the real `tracing_questions` course with the
 * `ai-grading` feature enabled and the Anthropic key injected from the
 * environment (`AI_GRADING_ANTHROPIC_API_KEY`), so we can drive the live Genie
 * flow end-to-end.
 */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  workerPort: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      await setupWorkerServer(workerInfo, use, {
        courseDirs: [TRACING_COURSE_PATH],
        configOverrides: {
          features: { 'ai-grading': true },
          aiGradingAnthropicApiKey: process.env.AI_GRADING_ANTHROPIC_API_KEY ?? null,
          // Auto-login as a plain student (not course staff) so we get the
          // student-facing assessment experience where the Genie renders.
          devModeAutoLogin: true,
          authUid: 'student@example.com',
          authName: 'Test Student',
          authUin: '111111111',
        },
      });
    },
    { scope: 'worker' },
  ],

  baseURL: async ({ workerPort }, use) => {
    await use(`http://localhost:${workerPort}`);
  },
});
