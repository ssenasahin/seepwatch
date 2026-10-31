# Seepwatch

Find your leaked secrets before someone else does.

Seepwatch will scan GitHub organizations, public repositories and paste sites for your domains, your
email addresses and the shapes of your API keys. Each thing it finds becomes an incident, and the
incident keeps escalating until someone says the secret has been revoked. Acknowledging it is not
enough: a leaked key stays dangerous until it stops working.

It is built on the same foundation as [Lanternly](https://github.com/ssenasahin/lanternly): the
accounts, team, alert channels, escalation policies, signed links and admin panel come from there.

## Status

The foundation runs: sign-up and sign-in with two-factor, teams and invites, Slack, Telegram and
webhook channels, escalation policies, API keys and the admin panel with its audit log. The scanners
don't exist yet, so nothing is watched and no incident is ever opened.

What comes next, in order:

1. Watches (domains, addresses, organizations, key patterns) and domain verification by a DNS TXT
   record.
2. Detectors, the GitHub source, findings and their fingerprints.
3. The incident state machine, escalation that repeats until revoked, and signed links with two
   actions: "I'm on it" and "revoked".
4. Gist and paste site sources.
5. The pages for findings, incidents and watches.

## Design decisions

**A raw secret is never stored.** A finding keeps the secret's SHA-256 hash, a masked form
(`AKIA…7XQ2`) and the surrounding lines with the secret redacted. If Seepwatch kept the secrets it
found, its own database would be the most valuable target in the system. The same hash found in a
second place joins the existing incident as another location instead of opening a new one.

**It only looks for what you own.** A domain is watched only after a DNS TXT record proves it is
yours, and email addresses hang off a verified domain. Generic key patterns (`AKIA…`, `ghp_…`,
`xox…`, `sk_live_…`, private key headers) are matched only inside your own organizations' repositories
and in content that already matched one of your domains or addresses. Without that limit, Seepwatch
would collect other people's leaks.

**Acknowledging doesn't stop the alarm.** An incident goes from open to acknowledged to revoked, or is
closed as a false positive or an accepted risk with a written reason. Acknowledging moves the
escalation to reminders; only "revoked" ends it.

**Signed links can't be clicked by a mail scanner.** Opening a link from an alert shows a page; the
action itself is a POST from that page, signed with HMAC-SHA256 for that incident and that recipient.

## What is stored

| Data                                             | Stored as                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| Passwords                                        | argon2id hash                                                       |
| TOTP secrets, channel tokens and webhook secrets | AES-256-GCM, key from `ENCRYPTION_KEY`                              |
| Refresh tokens, API keys, reset and invite links | SHA-256 hash                                                        |
| Access tokens                                    | Signed JWT, 15 minutes, kept in browser memory only                 |
| Admin actions                                    | Append-only audit log (a database trigger blocks edits and deletes) |

## Repository layout

```
api/                  Express API
  src/auth/           sign-up, sessions, refresh-token rotation, two-factor, lockout, resets
  src/channels/       Slack, Telegram and webhook channels
  src/escalation/     escalation policies
  src/team/           team members and invites
  src/api-keys/       API keys
  src/admin/          users, plans, system health and the audit log
worker/               BullMQ worker, where the scanners will run
db/                   Prisma schema, migrations and the code api and worker share
  src/network.ts      the SSRF guard for webhook deliveries
  src/crypto.ts       AES-256-GCM for secret columns
  src/escalation.ts   escalation steps and signed links
web/                  React dashboard
deployments/          production compose file and Caddy config
```

## Requirements

| Tool       | Version                 | Why                                                        |
| ---------- | ----------------------- | ---------------------------------------------------------- |
| Node.js    | 24 (`.nvmrc`), 22 works | api, worker and the web build                              |
| PostgreSQL | 16                      | everything that lasts                                      |
| Redis      | 7.4                     | job queues                                                 |
| Docker     | with Compose v2         | runs PostgreSQL, Redis and Mailpit locally, and production |

## Running it locally

```sh
npm install
cp .env.example .env          # then fill in JWT_SECRET, ENCRYPTION_KEY and SEED_DEMO_PASSWORD
docker compose up -d          # PostgreSQL, Redis and Mailpit
npm run db:migrate            # creates the tables
npm run db:seed               # demo@seepwatch.dev and a few accounts for the admin panel
npm run dev                   # api on :4000, worker, web on http://localhost:5173
```

Sign in as `demo@seepwatch.dev` with the password you put in `SEED_DEMO_PASSWORD`. Every email the
app sends shows up in Mailpit at http://localhost:8025. To use the admin panel, create a super admin
with `npm run admin:create`.

Checks before a commit, the same ones CI runs:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test                      # uses its own database, seepwatch_test
```

The API tests run against a real PostgreSQL rather than mocks, because constraint and transaction
bugs only show up in a real database.

## Deployment

Production runs on one machine with Docker: PostgreSQL, Redis, a migration step, the API, the worker,
and Caddy, which serves the dashboard, proxies `/api` and gets an HTTPS certificate on its own.

```sh
cp deployments/.env.example deployments/.env   # domain, database and Redis passwords, secrets, SMTP
docker compose -f deployments/compose.yml --env-file deployments/.env up -d --build
docker compose -f deployments/compose.yml --env-file deployments/.env exec api \
  node api/dist/cli/create-admin.js
```

## License

MIT. See [LICENSE](LICENSE).
