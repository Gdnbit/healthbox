# Public release checklist

Status: **experimental source Alpha; production NO-GO**.
This source distribution is prepared for publication with a new Git history;
no inherited private Git history or production container images are included.
Public availability and release assets must be verified on the repository itself.

Local checkpoint (2026-10-18): frontend tests/lint/build and a synthetic browser
flow passed; the candidate Docker image built. The latest backend full run had
2658 passes,24 skips,4 failures and64.30% coverage (required70%). Focused fixes
subsequently passed19 tests, not a replacement full run. Final-image migration,
backup and restoration remain unverified after Docker engine unavailability.
These results are not clinical validation or a public-deployment approval.

- [x] Review the selected source/fixture boundary; known scan findings are synthetic/translation false positives.
- [x] Confirm all three public catalogs are the original minimal replacements.
- [x] Preserve upstream attribution and attach format-appropriate notices to changed inherited files.
- [x] Exclude runtime files, private reports, old screenshots and private Git history from the source distribution.
- [x] Confirm the public Git author/committer uses the owner's verified GitHub account and GitHub-provided noreply address, not a personal email address.
- [x] Obtain the owner's explicit approval to create a separate public repository with new history; never expose old history.
- [x] Preserve upstream notice and publish source only, not a production deployment or bundled container distribution.
- [ ] Verify the public repository, root commit, release assets and remote CI results after publication.

The checked items describe the reviewed source-distribution policy, not a
guarantee for future edits. Re-run local privacy checks and manifest validation
on the exact snapshot before each disclosure. Public provenance is recorded in
UPSTREAM_PROVENANCE.json; the generated MODIFICATIONS.md lists the changed and
added distribution files. Repository metadata and the actual push are separate
manual decisions. Code of conduct, support policy, roadmap and changelog are
included, without claiming a stable release.

Source privacy gates must pass before source disclosure. Feature completeness,
full-suite coverage and production runtime acceptance remain separate tracked
work, not claims about this preview. Do not disable failing CI or label this
snapshot stable. Dependency/container-license review is additionally required
before shipping bundled dependency distributions or container images. Existing
GitHub artifacts stay private: publish a new history, never change the old
repository's visibility. See docs/healthbox/KNOWN_ISSUES.md.

The candidate deliberately excludes private agent records, historical audit
screenshots, old logos/avatars, previous deployment configuration and old Git
objects. Keep detailed internal audit evidence outside this source directory.
