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
webhook channels, escalation policies, API keys and the admin panel with its audit log. You can add
watches and prove they're yours. The worker scans GitHub, public gists and (with a Pastebin Pro
account) Pastebin for them, opens an incident for each new leak and keeps alerting until someone
marks it revoked. Alerts link to a page where anyone who got
one can say "I'm on it" or "it's revoked" without signing in. The overview counts active leaks and
lists the latest findings.

What comes next: the pages for findings and incidents, where a leak can also be closed as a false
positive or an accepted risk. Until then the API does it: `POST /api/incidents/:id/actions`.

## Watches

A watch is one thing to look for. There are four kinds:

| Kind                | Example           | How it's proven yours                                               |
| ------------------- | ----------------- | ------------------------------------------------------------------- |
| Domain              | `example.com`     | A TXT record at `_seepwatch.example.com` holding the watch's token  |
| Address             | `ops@example.com` | It must be on a verified domain or one of its subdomains            |
| GitHub organization | `acme`            | A file `seepwatch-verify.txt` in `acme/.github` holding the token   |
| Key pattern         | `acme_live_`      | No proof needed: it's only matched in content that is already yours |

The token sits on a name of its own, so it doesn't crowd the domain's SPF and other records, and only
an organization's members can write to its `.github` repository. A token belongs to one account's
watch, so publishing yours proves nothing for anyone else who added the same domain.

A key pattern is a prefix, a character set and a length range, never a regular expression you type.
Seepwatch builds the expression itself, so no pattern can make the scanner backtrack for ever, and
it won't match the prefix inside a longer word.

Each watch can have its own escalation policy; without one, a leak alerts you and every channel at
once. Deleting a domain deletes the addresses on it.

## Scanning

The worker looks for leaks in four places.

Verified organizations are read commit by commit, every 15 minutes. The scan lists the
organization's public repositories (forks and archived ones are skipped), reads the commits made
since the last scan and runs the detectors on the lines each commit added. The first scan goes back
30 days. A scan reads at most 200 commits, oldest first, and the next one continues where it
stopped, so a busy organization can't use up the hour's request allowance in one go.

Verified domains and the addresses on them go through GitHub's code search every 6 hours. A key
counts only if it sits within 10 lines of a mention of the domain or address; otherwise every key in
any file that mentions `example.com` once would be yours. Your own key patterns count anywhere in
such a file. Code search needs `GITHUB_TOKEN`, because GitHub refuses it to anonymous callers.

Gists and pastes can't be searched that way, so they're read as feeds instead. Every 5 minutes the
worker reads the public gists created or updated since its last run, up to 300, and matches each
file against every verified domain and address at once, with the same 10-line rule. The first run
starts an hour back. Pastebin works the same way every 2 minutes, through its scraping API. That API
needs a lifetime Pro account and answers only the IP address registered with it, so it stays off
unless `PASTEBIN_SCRAPING` is `true`. Other paste sites offer no sanctioned way to read new
pastes, and Seepwatch doesn't scrape them. The admin panel's system health page shows how far each
feed got and why it last stopped short.

The built-in detectors know AWS access keys, GitHub tokens, Slack tokens and webhooks, Stripe live
keys, Google API keys and private key blocks. When a scan stops short, for example because the rate
limit ran out, it keeps what it read and the watch shows why it stopped.

Proof is checked again every night. A domain can expire and be bought by someone else, and an
organization can change hands, so a watch whose token is missing three nights in a row stops being
scanned until its owner proves it again.

## Incidents

Every new finding opens an incident, and its first alert goes out within half a minute. Where the
incident goes from there:

| Status         | How it gets there                      | What happens                                  |
| -------------- | -------------------------------------- | --------------------------------------------- |
| Open           | A secret is found for the first time   | The escalation policy runs, step by step      |
| Acknowledged   | Someone says "I'm on it"               | No more escalation; reminders every 4 hours   |
| Revoked        | Someone says the key no longer works   | Everyone alerted hears it's over; alerts stop |
| False positive | Closed in the dashboard, with a reason | The same                                      |
| Risk accepted  | Closed in the dashboard, with a reason | The same                                      |

While an incident is open, each step of the watch's escalation policy is alerted in turn. Once the
steps run out, everyone alerted so far hears about it again every hour until someone responds. A
watch without a policy alerts you and every channel at once, then hourly. A closed incident stays
closed. If the same secret turns up somewhere else, its incident's timeline says so and no new
incident is opened.

The worker doesn't keep a delayed job per alert. Each incident stores when its next round is due,
and the worker looks for due rounds every 30 seconds. Responding only changes that time, so there
is never a queued alert that has to be found and cancelled.

## Design decisions

**A raw secret is never stored.** A finding keeps a fingerprint of the secret (HMAC-SHA256 with a
key derived from `ENCRYPTION_KEY`), a masked form (`AKIA…7XQ2`) and the surrounding lines with the
secret redacted. If Seepwatch kept the secrets it found, its own database would be the most valuable
target in the system. A plain hash wouldn't do either: the shape of most keys is public, so a
short one could be guessed back from its hash. The same fingerprint found in a second place is added
to the existing finding as another location instead of becoming a new one.

**It only looks for what you own.** A domain is watched only after a DNS TXT record proves it is
yours, and email addresses hang off a verified domain. Generic key patterns (`AKIA…`, `ghp_…`,
`xox…`, `sk_live_…`, private key headers) are matched only inside your own organizations' repositories
and in content that already matched one of your domains or addresses. Without that limit, Seepwatch
would collect other people's leaks.

**Acknowledging doesn't stop the alarm.** An incident goes from open to acknowledged to revoked, or is
closed as a false positive or an accepted risk with a written reason. Acknowledging moves the
escalation to reminders; only closing ends it, and from an alert the only way to close is "revoked".

**Signed links can't be clicked by a mail scanner.** Opening a link from an alert shows a page; the
action itself is a POST from that page, signed with HMAC-SHA256 for that incident and that recipient.
The timeline shows who acted: the address the link was emailed to, or the channel it was posted in.

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
  src/watches/        watches, their values and verification
  src/findings/       findings and where each was seen
  src/incidents/      incidents, their actions and the page alerts link to
  src/api-keys/       API keys
  src/admin/          users, plans, system health and the audit log
worker/               BullMQ worker
  src/github.ts       the GitHub API calls the scanners make
  src/scan-org.ts     reading an organization's new commits
  src/scan-search.ts  code search for domains and addresses
  src/feeds.ts        the gist and Pastebin feeds, matched against every watch
  src/match.ts        whether a key sits near a mention of a domain or address
  src/scan.ts         which watches are due, and running one scan
  src/reverify.ts     the nightly re-check of each proof
  src/incidents.ts    opening incidents for new findings
  src/alerts.ts       alert rounds: who hears what, and when the next one is due
  src/notify.ts       alert emails and channel messages
db/                   Prisma schema, migrations and the code api and worker share
  src/network.ts      the SSRF guard for webhook deliveries
  src/crypto.ts       AES-256-GCM for secret columns
  src/escalation.ts   escalation steps and signed links
  src/incidents.ts    the incident rules: which action goes where, and each alert round
  src/watches.ts      key patterns as safe regular expressions
  src/detectors.ts    the detectors, masking and fingerprints
  src/verification.ts DNS TXT and GitHub file verification
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

The API and worker tests run against a real PostgreSQL rather than mocks, because constraint and transaction
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
