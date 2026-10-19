# Synthetic browser flow evaluation map

- `cases/browser-flow.json` defines the synthetic filenames, UI-visible labels, viewports, and lifecycle nodes.
- `golden/browser-flow-state.json` is the authoritative count/status truth for source → preview → review → commit → rollback.
- The CSV payload is reused from `evals/entry-workspace/cases/generic-lab-csv.csv`.
- The PDF is generated at runtime with ReportLab and contains only the labels declared here.
- The committed metrics view downloads one standalone SVG and one UTF-8 BOM CSV, checks full source provenance and a privacy-safe filename, invokes the print/save-PDF action, and verifies that these actions do not change formal data.
- The export menu is exercised at both desktop and 390 px mobile viewports.
- These fixtures must never include a personal filename, personal value, filesystem path, credential, copied report text, or hospital template.

The golden files are business truth and must not be weakened to make selectors or implementation pass.
