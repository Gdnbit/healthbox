# Evals: local bootstrap access

## Runner

`python -m pytest tests/core/test_create_default_user.py tests/scripts/test_create_local_bootstrap_account.py tests/api/test_auth.py -q`

## Cases

- `E-AUTH-001`: configured fresh-install bootstrap creation
- `E-AUTH-002`: public weak-password rejection remains
- `E-AUTH-003`: initialized startup remains a no-op
- `E-AUTH-004`: logs and command output omit credentials
- `E-AUTH-005`: Compose remains localhost-only
- `E-AUTH-006`: explicit current-instance creation is idempotent

## Golden output policy

The requested initial credential is business input, not a printable golden value. Golden status output contains outcomes only and must never contain a password or hash.
