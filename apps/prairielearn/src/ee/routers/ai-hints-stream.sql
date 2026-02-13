-- BLOCK select_submission_for_ai_hints
SELECT
  s.id,
  s.variant_id,
  s.score,
  s.feedback,
  s.submitted_answer,
  v.id AS variant_id,
  v.true_answer,
  v.question_id,
  gj.id AS grading_job_id
FROM
  submissions AS s
  JOIN variants AS v ON (v.id = s.variant_id)
  JOIN grading_jobs AS gj ON (gj.submission_id = s.id)
WHERE
  s.id = $submission_id
  AND v.instance_question_id = $instance_question_id
ORDER BY
  gj.date DESC
LIMIT
  1;
