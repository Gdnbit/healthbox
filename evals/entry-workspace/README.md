# Entry workspace evaluation map

- `cases/generic-lab-csv.csv` + `golden/generic-lab-csv-preview.json`: canonical three-row synthetic truth for quantitative, qualitative, and textual candidates.
- `cases/generic-lab-csv-invalid.csv` + `golden/generic-lab-csv-invalid-preview.json`: deterministic invalid-date, formula-prefix, and unsupported-qualitative failures.
- Backend tests map these files to `CASE-ENTRY-GOLDEN`, `INVALID`, `FORMULA`, `LIMITS`, `ACCESS`, and `NO-WRITE`.
- Frontend component tests map to `CASE-ENTRY-UI`, `WORKSPACE`, `REVIEW`, and `I18N`.

The files are synthetic and must not contain a personal filename, value, report excerpt, filesystem path, credential, or copied hospital template. Golden outputs are business truth and must not be weakened to make implementation pass.

