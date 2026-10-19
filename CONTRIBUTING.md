# Contributing to HealthBox

This project is a household-focused customization of MediKeep. Contributions should preserve upstream attribution, privacy boundaries, human-review gates and recoverability.

## Data and privacy rules

Never commit real health reports, screenshots, runtime databases, uploads, backups, credentials or household-member personal data. Use synthetic fixtures only.

## Preserve these product boundaries

- OCR/parser output is provisional until reviewed.
- AI output must not silently become an official health fact.
- Member/admin visibility must remain explicit and scoped.
- Official revisions should preserve history where the product contract requires it.
- Backup/restore work must not risk an existing household instance during development.
- Claims about live-model quality, deployment status or medical validity require separate evidence.

## Upstream attribution

When changing code inherited from MediKeep, keep upstream copyright/license information intact. Clearly separate household-specific behavior from upstream functionality in documentation and release notes.

Contributions must be yours to submit or have compatible permission. Unless
explicitly stated and accepted otherwise, contributions are under this
repository's Apache-2.0 license. Do not include third-party datasets, portraits,
reports or copied code without verifying their terms and preserving notices.
The source packager preserves applicable upstream notices and adds distribution
modification notices; do not remove them when editing or regenerating files.

## Pull requests

Keep PRs focused. State:

1. what user/privacy problem is being changed;
2. whether the change is upstream-derived or household-specific;
3. which data/review boundary it touches;
4. how it was tested;
5. what remains unverified.

## Security

Follow [`SECURITY.md`](SECURITY.md) for vulnerabilities, accidental health-data exposure or credential leakage. Do not place sensitive details in public issues or PRs.
 
## CI scope and security gates

HealthBox supports a **narrow presentation-only fast path** for changes to
existing `README.md`, `README_EN.md` and `README.zh-CN.md`. Such a PR
still runs mandatory public source privacy, attribution/notice and catalog
checks; it skips unrelated full frontend/backend/browser tests, Docker image
builds and dependency audits.

All other changes (including added/deleted files, code, dependencies, medical
catalogs, privacy and authorization policies, packaging, CI and release docs)
run complete checks. Unknown commit ancestry/events and manual runs default
to the full route; `source-privacy` is never optional.

This is an update-speed optimization, not production or real-health-data
authorization. Outstanding coverage/security findings remain recorded in
[known issues](docs/healthbox/KNOWN_ISSUES.md) and must be resolved before
a production release.
