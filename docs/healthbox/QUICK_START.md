# Run HealthBox locally

Use only synthetic records while evaluating this candidate. You need Docker
Engine/Desktop and Docker Compose v2. The image builds the frontend and backend
from source. Nothing is downloaded from a prebuilt personal HealthBox image.

1. Copy `.env.example` to `.env` in the project root.
2. Generate three distinct random values locally. For example, run
   `python -c "import secrets; print(secrets.token_hex(32))"` separately for
   DB_PASSWORD, SECRET_KEY and ADMIN_DEFAULT_PASSWORD. Put each value in `.env`.
   Do not reuse examples or commit this file.
3. Start a separate instance:

```sh
docker compose -f compose.healthbox.yml config --quiet
docker compose -f compose.healthbox.yml up --build -d
docker compose -f compose.healthbox.yml ps
```

Open http://127.0.0.1:18085 and sign in with your configured administrator.
Change the initial password when prompted. The first administrator has no
universal default password. Public registration is disabled. Create invitations
from the administrator interface and share only with your intended test users.

The Compose project owns four named volumes. PostgreSQL has no host port.
`docker compose -f compose.healthbox.yml down` stops containers and keeps data.
Do not use `down -v` on an instance whose data you want to retain.

For a first trial, create a synthetic member, accept its invitation, upload a
fabricated digital lab PDF, review candidates and explicitly submit. Inspect
trends, export CSV, and check source/revision history. Unconfirmed candidates do
not become formal observations. Complex scans may need manual entry.

This is a localhost trial configuration: HTTP cookies are not Secure and AI is
disabled. Before any real/public deployment, configure TLS, Secure cookies,
reverse-proxy limits, backups outside the server and the intended data policy.
The candidate is not currently approved for public or real-health-data use.

## Development

Node 22.22+ and Python 3.12 are the CI baseline. Use an isolated Python venv:

```sh
python -m venv .venv
# Activate the venv using your shell's command.
python -m pip install -r requirements.txt
python -m pytest tests/
cd frontend
npm ci
npm run lint
npm run test:run
npm run build:check
```

The frontend alone does not provide a backend or a database. The production
entry is `/family-health`; `/prototype/household-health` is development-only.
The inherited synthetic browser harness requires requirements-e2e.txt and
Playwright Chromium. Enable RUN_SYNTHETIC_BROWSER_E2E=1 explicitly.
