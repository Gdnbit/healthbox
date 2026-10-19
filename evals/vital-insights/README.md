# Vital insights evaluation map

- `CASE-VITAL-ACCESS`: backend cross-patient tests for both compatibility and patient-path stats endpoints.
- `CASE-VITAL-CATALOG`, `CASE-VITAL-DUAL`, `CASE-VITAL-UNIT`, `CASE-VITAL-COVERAGE`: pure synthetic fixtures in `frontend/src/utils/vitalInsights.test.ts`.
- `CASE-VITAL-UI`: component test for load, empty/error states, catalog selection, management navigation, and existing trend drawer integration.
- `CASE-VITAL-FAMILY`: household summary and page tests reconcile separate laboratory/vital counts, latest dates, member switching, and isolated stats failure.
- `CASE-VITAL-I18N`: repository translation parity, Chinese-quality, exposed-key, and UI-literal sensors.

No real health value, report text, filename, filesystem path, or credential is permitted in this evaluation set.

Observed 2026-07-22: the combined targeted suite passed 71 backend and 39 frontend tests; exact feature ESLint, 17-namespace Chinese quality, 714-file UI-literal scan, Vite production build, live-container health, archive verification, and an isolated 67-table restore drill also passed. Authenticated visual browser evaluation remains pending the legitimate first-password-change prerequisite.
