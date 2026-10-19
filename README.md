<!-- Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md. -->
# HealthBox · 健康档案盒

**把分散的健康资料，整理成自己的长期健康档案。**

An open-source personal and family health records manager.

[中文说明](README.zh-CN.md) · [Quick start](docs/healthbox/QUICK_START.md) · [Architecture](docs/healthbox/ARCHITECTURE.md)

Reports, lab sheets and everyday measurements are often scattered across paper,
photos and hospital portals. HealthBox keeps originals, helps you review
structured information, and organizes confirmed records into a long-term
timeline with trends and portable exports.

It is designed for a self-hosted personal/family instance with a small number
of invited accounts. Members maintain their own records; administrator-managed
reciprocal groups can view a limited structured dashboard.

| Capability | Current scope |
|---|---|
| Original files | Images/PDF, multi-file progress/retry, hashes, duplicate review and reversible withdrawal |
| Reviewed data | Manual/CSV and limited local PDF/OCR candidates; explicit commit and revision history |
| Trends | Real observation dates, one or two pinned metrics, detail tables and comparisons |
| Export | CSV/SVG/print plus self-owned archive packages |
| Accounts | Invitations, one administrator, reciprocal sharing, scoped source access and administrator MFA |
| AI | Disabled by default; read-only recent-changes adapter and separate answer history; no approved model |
| Screening | Limited educational navigation; personalized schedules and disease probabilities are not implemented |

**Status: experimental source preview, not production-ready.** Source disclosure
and production readiness are separate decisions. Known vulnerabilities,
incomplete functionality and failing quality gates are disclosed in
[known issues](docs/healthbox/KNOWN_ISSUES.md); existing gates are not weakened.
The source-only packager replaces inherited medical catalogs with original
minimal labels (13 measurements,3 panels,3 vaccines), without LOINC/WHO codes,
clinical thresholds or patient data. Synthetic dynamic_test answers do not
validate a real language model. See the [source-publication checklist](PUBLIC_RELEASE_CHECKLIST.md).

## Try it locally

Use Docker Compose v2 and fabricated data. Copy .env.example to .env, generate
three distinct random secrets, then follow the
[complete startup guide](docs/healthbox/QUICK_START.md).

```sh
docker compose -f compose.healthbox.yml config --quiet
docker compose -f compose.healthbox.yml up --build -d
```

Open http://127.0.0.1:18085. The local Compose uses separate named volumes,
does not publish PostgreSQL, and requires an explicitly configured strong
administrator password. It is not a public HTTPS configuration.

## Data remains yours

The data flow is: retain original → extract/manual candidate → human review →
explicit commit → trend/archive → export. OCR can fail; its output is never
automatically a formal fact. Formal corrections retain versions. Back up both
database and files, and verify restoration outside the running instance.
See [operations](docs/healthbox/OPERATIONS.md) and
[privacy/AI limitations](docs/healthbox/PRIVACY_AND_AI.md).

HealthBox is not a diagnosis, treatment-decision or emergency-monitoring system.
AI cannot write health facts and does not replace professional judgment.

## Upstream and contribution

Derived from [MediKeep](https://github.com/afairgiant/MediKeep),
Copyright 2025 Alex Fair. Inherited domains and infrastructure are distinguished
from the household sharing, reviewed import, Chinese lightweight UI and scoped
AI changes in [ACKNOWLEDGEMENTS](ACKNOWLEDGEMENTS.md).
Licensed under [Apache-2.0](LICENSE); retain [NOTICE](NOTICE).
No official affiliation with upstream is implied.

See [CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md), [support](SUPPORT.md),
[roadmap](ROADMAP.md), [changelog](CHANGELOG.md) and [community conduct](CODE_OF_CONDUCT.md).
Never attach real health records, credentials or runtime databases to issues,
pull requests, test fixtures or public artifacts.
