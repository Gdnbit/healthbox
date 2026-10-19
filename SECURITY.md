# Security and Privacy Policy

HealthBox handles highly sensitive personal health information. Privacy failures, unauthorized access and accidental data disclosure should be treated as security issues.

## Never commit real health data

Do not commit or attach:

- medical reports, lab sheets or identifiable screenshots;
- runtime databases, uploads or backups;
- names, identifiers or other household-member personal data used in real operation;
- API keys, passwords, MFA secrets, recovery material or access tokens;
- `.env` files or logs containing credentials/private data.

Use synthetic fixtures and anonymized examples only.

## Reporting

If GitHub private vulnerability reporting is enabled, use it.

Otherwise, open a minimal issue asking the maintainer for a private reporting path. Do not include health information, credentials, exploit payloads or other sensitive material in a public issue.

If a credential is exposed, revoke or rotate it immediately. Removing it from the latest commit does not remove it from Git history.

## High-priority issues

Examples include:

- cross-member data leakage;
- unauthorized admin/member access;
- bypass of review gates that allows provisional OCR/AI output to become official health facts;
- unsafe file upload/path behavior;
- backup/restore behavior that exposes or overwrites household data;
- credential leakage through logs, exports or deployment files;
- AI/tool paths that write official records without required review;
- insecure sharing or invitation flows.

## Medical boundary

Security controls do not make AI output medically authoritative. This repository is not a diagnostic service, and software correctness/security should be evaluated separately from clinical validity.

## Upstream

This project is derived from MediKeep. When a vulnerability clearly originates upstream, coordinate responsibly with the upstream project while avoiding disclosure of private household data or local deployment details.
