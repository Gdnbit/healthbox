# Source-only publication procedure

This procedure discloses an experimental source snapshot, not a hosted service
or stable container release. It never publishes the existing private Git history.

1. From an authorized working checkout run the packager with a new destination
   outside the checkout and a separate private manifest path:

   ```sh
   python scripts/healthbox-package.py ../healthbox-source-review --manifest ../private-review-manifest.json
   ```

2. Review the generated source. The three shared/data catalogs must match
   config/open-source-catalogs. The packager does not copy old Git objects,
   screenshots, original reports, ignored runtime stores or inherited catalogs.
3. Run the offline privacy gate. Keep owner-specific regex values (local home
   paths, domains, identities) in a private JSON array outside the candidate:

   ```sh
   python scripts/healthbox-privacy-check.py ../healthbox-source-review --private-patterns ../private-owner-patterns.json --report ../private-source-privacy.json
   ```

   Never commit those private patterns or reports. The gate prints counts,
   categories and status only, not matching text. It cannot prove semantic
   anonymity or detect every possible secret. Review fixture provenance and
   run a separate local secret scanner, preserving false-positive dispositions.
4. Check README links, notices, environment examples and synthetic-only fixtures.
   Confirm there is no .git, database, report, log, screenshot, symlink/junction,
   key, source map, private path or owner identifier in the source boundary.
   The packager compares normalized content against UPSTREAM_PROVENANCE.json
   for the fixed public MediKeep baseline. Changed inherited files receive
   in-file notices; MODIFICATIONS.md is generated for this exact snapshot.
   JSON files use a top-level metadata string without rewriting existing data.
   Validate syntax, metadata tolerance and source preservation before publishing.
5. Record a file manifest privately. Changing any file invalidates its prior
   hash. Recheck the final snapshot rather than relying on an earlier scan.
6. Obtain explicit owner approval for a new repository and public Git identity.
   Author names/emails, branch names and commit messages are public metadata.
   Initialize a fresh history only after that review; never copy the original
   .git or make the existing private repository public.

Known quality gaps are disclosed in KNOWN_ISSUES.md. Existing CI tests and audit
gates remain active. Public issue templates must never request real health
records, screenshots, credentials or production logs. This source procedure
does not authorize a push, repository creation, release or public deployment.
