# Coverage evidence evals

Synthetic-only cases for explicit checkup absence statements and merged coverage evidence.

- Canonical case data: `cases/coverage-cases.json`
- Golden merged output: `golden/merged-matrix.json`
- Backend sensor: `tests/api/test_health_coverage.py`
- Frontend domain sensor: `frontend/src/utils/healthCoverageEvidence.test.ts`
- Component/page/browser sensors are added before UI implementation.

Stop gates: blank-as-not-performed, future statement acceptance, stale overwrite, cross-member access/source, hidden formal/statement conflict, percentage output, raw note in audit, export server path, real-data fixture.
