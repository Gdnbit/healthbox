# Architecture and data ownership

HealthBox is a React/Vite/Mantine frontend served by a FastAPI backend with
PostgreSQL, private upload storage and database-backed background tasks.

Data flow: retained original → parser/manual candidate → review → explicit
transactional commit → versioned formal records → trends/export. A failed
parser keeps the original. Formal corrections create revisions; rollback is
blocked when later revisions/dependencies make removal unsafe.

An account owns one health subject. The sole administrator manages reciprocal
archive circles. Circle overlap is not transitive. Ordinary shared viewers see
structured dashboards, not originals, private narrative, editing or AI history.
The disclosed administrator capability can read more data and is audited.

The model adapter has no write tools. It reads server-resolved, self-owned
formal records only. Endpoint/model configuration belongs to the sole
administrator; secrets stay server-side. The current in-app question is
restricted to recent changes. Local-copy question packages are separate from
an actual model call. dynamic_test is a deterministic synthetic test double.
No tested local model has passed the current complete grounding gate.

HealthBox retains internal MediKeep module names, database identifiers,
migration IDs, cookie/cache compatibility keys and API routes. Renaming these
would require an independently tested compatibility migration.
