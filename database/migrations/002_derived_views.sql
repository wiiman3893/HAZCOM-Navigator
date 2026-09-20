-- Derived projections required by the Constellation specification.
-- These are views, not duplicate authoritative fields.

CREATE VIEW IF NOT EXISTS v_work_area_compliance AS
SELECT
  wa.id AS work_area_id,
  MAX(hr.review_date) AS latest_hazcom_review_date,
  CASE
    WHEN MAX(hr.review_date) IS NULL THEN NULL
    ELSE date(MAX(hr.review_date), '+12 months')
  END AS next_review_due
FROM work_area wa
LEFT JOIN work_area__ownership wao ON wao.child_id = wa.id
LEFT JOIN hazcom_review__ownership hro ON hro.work_area_id = wa.id
LEFT JOIN hazcom_review hr ON hr.id = hro.child_id AND hr.deleted_at IS NULL
WHERE wa.deleted_at IS NULL
GROUP BY wa.id;

CREATE VIEW IF NOT EXISTS v_chemical_product_compliance AS
SELECT
  cp.id AS chemical_product_id,
  MAX(sv.verified_at) AS latest_sds_verification_date,
  CASE
    WHEN MAX(sv.verified_at) IS NULL THEN NULL
    ELSE date(MAX(sv.verified_at), '+6 months')
  END AS verification_due
FROM chemical_product cp
LEFT JOIN sds_verification__ownership svo ON svo.chemical_product_id = cp.id
LEFT JOIN sds_verification sv ON sv.id = svo.child_id AND sv.deleted_at IS NULL
WHERE cp.deleted_at IS NULL
GROUP BY cp.id;

CREATE VIEW IF NOT EXISTS v_assignment_training_status AS
SELECT
  waa.id AS work_area_assignment_id,
  waa.training_required_since,
  MAX(te.training_date) AS latest_training_date,
  CASE
    WHEN MAX(te.training_date) IS NOT NULL
     AND date(MAX(te.training_date)) >= date(waa.training_required_since)
    THEN 'current'
    ELSE 'required'
  END AS training_status
FROM work_area_assignment waa
LEFT JOIN training_event__ownership teo ON teo.work_area_assignment_id = waa.id
LEFT JOIN training_event te ON te.id = teo.child_id AND te.deleted_at IS NULL
WHERE waa.deleted_at IS NULL
GROUP BY waa.id, waa.training_required_since;
