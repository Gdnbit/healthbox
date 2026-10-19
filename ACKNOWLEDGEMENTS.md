# Upstream and third-party attribution

HealthBox derives from [MediKeep](https://github.com/afairgiant/MediKeep),
Copyright 2025 Alex Fair, under Apache-2.0. The original copyright is retained
in NOTICE and the complete license is distributed as LICENSE.

Inherited functionality includes the FastAPI/React application, core health
record domains, authentication foundations, attachments, reports and backup
tools. Household-specific changes add reciprocal structured sharing,
review-first source imports, immutable imported-metric revisions, lightweight
Chinese dashboards, and bounded read-only AI integration contracts.

The HealthBox wordmark and replacement geometric SVG icons were created for
this derivative. Old avatars, screenshots and upstream logos are excluded
from the public candidate because their provenance has not been established.

React, FastAPI, Mantine, Tabler/Lucide icons, charting libraries, PostgreSQL,
Tesseract, Poppler and the other dependencies keep their own licenses.
Package manifests are not a license clearance: review the generated dependency
inventory before redistributing bundled software or container images. Fonts
installed in the container retain their distribution license files.

The internal working checkout retains inherited reference catalogs. The
source-only packager replaces all three shared/data catalogs with original
minimal files from config/open-source-catalogs under Apache-2.0; it does not
redistribute the inherited WHO/LOINC-derived catalog payloads. Existing schema
field names remain for compatibility, with no WHO/LOINC identifiers supplied
by the starter files. They are labels, not medical definitions or schedules.
