# Experimental source preview: known issues

Updated2026-10-19. This project is being developed in the open; source
availability is not evidence of production security, medical validity or
feature completeness. Do not use it as a diagnostic or emergency system.

Focused checks on the minimal-catalog distribution:47 backend catalog compatibility
tests passed;14 privacy-boundary tests and3 starter-data contract tests passed;
TypeScript checking and the Vite production build passed. This is not full-suite
or real-data acceptance. CI workflow static validation also passed locally.

## Current engineering limitations

- The preceding full backend run had2658 passes,24 skips,4 failures and64.30%
  coverage, below the retained70% requirement. The four test-contract failures
  were subsequently fixed with19 focused passes. That is not a full rerun.
- The preceding frontend full run passed2855 tests with137 skipped; lint,
  type/build and one synthetic browser flow passed. These results preceded
  the minimal-catalog distribution. Only newly recorded focused checks can
  establish compatibility for that distribution; do not transfer full-suite
  claims from the larger internal catalog.
- npm audit after compatible fixes still reports24 development/runtime records
  (including high/critical development-tool findings). The runtime-only view
  has3 low/moderate records, no high/critical. Python audit has3 raw records
  in python-jose/ecdsa, including a duplicate. These are unresolved, not ignored
  or a guarantee of exploitable production paths. Quality/security CI may fail.
- The previous full-catalog image built locally, but final-image runtime/restore
  acceptance was interrupted by unavailable Docker infrastructure. There is no
  verified, published container for this minimal-catalog snapshot.
- Real external AI quality, real-device mobile operation and arbitrary hospital
  report layouts have not been validated. AI is disabled by default.

## Minimal data distribution

Public packaging uses original files from config/open-source-catalogs, not
the inherited medical reference payloads. It supplies13 common measurement
labels,3 organizational panel labels and3 generic vaccine labels. It does not
supply clinical intervals, disease probabilities, branded vaccine definitions,
LOINC/WHO codes or default units. Confirm every unit against the source report.

Some inherited tests expect the larger upstream catalog and may fail for this
preview. Keep those failures visible; do not skip them to claim full coverage.
Parser candidates still require human review. Replacing the catalogs reduces
autocomplete/matching; unknown indicators should be entered manually.

Third-party data may be added only after source, redistribution terms and
required attribution are verified. Schema names such as who_code/loinc_code
are retained for compatibility; their presence does not mean a standard dataset
is bundled or that a mapping is clinically correct.

## Before real deployment

Resolve relevant dependency risks, pass the retained test/security gates,
verify migration/backup/restore on a new isolated database and file store,
configure TLS/secure cookies, review authorization and failure behavior, and
review notices for any bundled dependencies or container components. Never
copy runtime data or private development history into a public repository.
