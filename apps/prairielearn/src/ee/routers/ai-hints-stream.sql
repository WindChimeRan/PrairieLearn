-- BLOCK select_submission_for_ai_hints
SELECT
  s.id,
  s.variant_id,
  s.score,
  s.feedback,
  s.partial_scores,
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

-- BLOCK select_variant_for_ai_hints
SELECT
  *
FROM
  variants
WHERE
  id = $variant_id;

-- BLOCK count_ai_hints_for_instance_question
SELECT
  COALESCE(
    SUM(
      CASE
        WHEN jsonb_typeof(s.feedback -> 'ai_hints') = 'array' THEN jsonb_array_length(s.feedback -> 'ai_hints')
        WHEN s.feedback ? 'ai_hints'
        AND s.feedback ->> 'ai_hints' != '' THEN 1
        ELSE 0
      END
    ),
    0
  )::integer AS hint_count
FROM
  submissions AS s
  JOIN variants AS v ON (v.id = s.variant_id)
WHERE
  v.instance_question_id = $instance_question_id;

-- BLOCK select_history_for_ai_hints
SELECT
  s.id,
  s.date,
  s.submitted_answer,
  s.partial_scores,
  s.feedback -> 'ai_hints' AS ai_hints
FROM
  submissions AS s
  JOIN variants AS v ON (v.id = s.variant_id)
WHERE
  v.instance_question_id = $instance_question_id
ORDER BY
  s.date ASC;
