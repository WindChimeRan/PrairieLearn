/**
 * Whether the AI-hints endpoint should generate a hint for a submission with
 * the given grading score.
 */
export function shouldGenerateHintForScore(score: number | null): boolean {
  // Offer a hint for any graded submission, including fully-correct ones. This
  // mirrors the UI gate in `SubmissionPanel`, which shows the Genie whenever
  // `submission.score != null`.
  return score != null;
}
