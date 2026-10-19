# Configuration, backup and updates

Required root environment variables: DB_PASSWORD, SECRET_KEY and
ADMIN_DEFAULT_PASSWORD. Optional: ADMIN_DEFAULT_USERNAME, APP_PORT and TZ.
Use distinct random secrets. The initial administrator password must contain
letters and digits and be at least 12 characters. It is not an ongoing password
reset channel once an administrator exists.

The supplied local Compose binds only 127.0.0.1, uses synthetic mode, disables
public registration, external release-note fetches and AI, and creates its own
named volumes. Do not attach existing private volumes when trying a candidate.

Use the administrator backup center to create a complete application backup,
verify archive hashes and rehearse restoration into a different instance. A
personal export is portable health information; it is not a full application
backup. A copy on the same server does not protect against server loss.

Before updates, record the deployed image identity and migration head, create
and verify a fresh complete backup, restore it in isolation, and test migration
upgrade/downgrade compatibility. Preserve the previous image and volumes until
acceptance. Never reset a database or silently roll back revisions.

Secrets, private uploads, logs, source archives and backups must remain outside
Git and build contexts. Public reverse-proxy/TLS setup is deployment-specific
and is not performed by the local quick start. MFA and recovery codes for the
sole administrator should be verified before exposing a real instance.
