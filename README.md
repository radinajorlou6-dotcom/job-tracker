# Job Tracker

A job application tracker that goes beyond tracking. It pulls internship and
new-grad listings from external feeds into your own database, scores them
against what you actually want, makes logging an application one click, and
keeps watching the posting after you have applied.

```
job-tracker-fullstack/
├── job-tracker-backend/     Express 5 + Prisma + Postgres API
└── job-tracker/             React 19 SPA (Create React App)
```

## Running it

Both halves need their own terminal.

```bash
# API — http://localhost:3001
cd job-tracker-backend
npm install
npx prisma migrate deploy && npx prisma generate
npm run dev

# Web — http://localhost:3000
cd job-tracker
npm install
npm start
```

### Environment

`job-tracker-backend/.env`

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `CLERK_SECRET_KEY` | yes | Verifies the bearer token on every request |
| `CREDENTIAL_SECRET` | for BYO keys | Encrypts user-supplied API keys at rest. ≥32 chars |
| `ANTHROPIC_API_KEY` | no | Shared fallback key. Omit to require every user to bring their own |
| `ANTHROPIC_MODEL` | no | Defaults to `claude-opus-5` |
| `ANTHROPIC_EFFORT` | no | `low` (default), `medium`, `high`, `xhigh`, `max` |
| `LISTING_REFRESH_HOURS` | no | Feed refresh interval, default 6 |
| `DISABLE_AUTO_IMPORT` | no | Set `true` to skip the scheduled feed refresh |

Generate `CREDENTIAL_SECRET` once, then keep it stable:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Rotating it does not lose data — it only makes already-stored keys undecryptable,
and affected users simply re-enter theirs.

`job-tracker/.env`

| Variable | Purpose |
|---|---|
| `REACT_APP_API_URL` | Backend base URL |
| `REACT_APP_CLERK_PUBLISHABLE_KEY` | Clerk frontend key |

## The four features that matter

### One-click apply

`POST /applications/from-listing/:listingId` copies every field from the listing
— company, role, link, locations, terms, degrees, sponsorship, category — into a
new application. Hand-added and imported entries carry the same columns, so the
tracker renders them identically.

### AI matching

`lib/matcher.js` scores listings against your saved preferences.

- With a key available, batches of 12 listings go to Claude with a JSON schema
  (`output_config.format`), returning a score, verdict, reasons, concerns, and a
  one-line summary per listing.
- Without a key — or if a batch errors or is refused — a deterministic scorer
  produces the same shape, so a run always returns a complete result set.

**Each user brings their own API key**, entered under Preferences → Your Claude
API key, so scoring bills to their own Anthropic account. Key resolution per run
is: the user's own key → the server-wide `ANTHROPIC_API_KEY` if one is set →
the deterministic scorer.

Keys are encrypted with AES-256-GCM (random IV per write, auth tag verified on
read) under `CREDENTIAL_SECRET` before being stored, and no endpoint ever
returns the plaintext — the UI only sees a masked preview like `sk-ant-api…4f2a`.
A key is checked against Anthropic before it is saved, using `models.list`, so
verification costs no tokens. If `CREDENTIAL_SECRET` is missing the app refuses
to store keys rather than falling back to plaintext.

The engine is part of `prefsHash`, so adding a key correctly marks
heuristic-scored listings as stale and prompts a re-run.

Runs happen in the background (`POST /match/run`) because scoring a few hundred
listings takes longer than one HTTP request should; the client polls
`GET /match/status` for progress.

`prefsHash` fingerprints your preference set. Editing preferences marks existing
scores stale rather than deleting them, so the feed keeps working until you
re-run.

### Change detection

Each listing carries a `contentHash` over only the fields a user would notice
(company, role, url, locations, terms, degrees, sponsorship, category, active).
Timestamps are excluded, so a no-op re-publish upstream is not reported as an
edit.

Applying freezes a `snapshot` of the listing plus its hash. An application shows
a pending change when the listing's current hash differs from **both** the
snapshot hash and whatever you last dismissed:

- **Pull in the update** copies the new values across and re-freezes the snapshot.
- **Keep my version** records the current hash as dismissed. Your record is
  untouched, and a later upstream edit produces a new hash so the badge returns.

Your record is never mutated by the feed unless you say so.

### Analytics

`GET /applications/analytics` computes response rate, interview rate, offer
rate, median days to first response, a funnel, and cumulative volume over a
configurable window. Rates come from `ApplicationEvent` rows — real status
history, not a guess from the current status.

## Feeds

Three SimplifyJobs repositories, in `lib/listings.js`:

| Key | Source |
|---|---|
| `summer2027` | SimplifyJobs/Summer2027-Internships |
| `summer2026` | SimplifyJobs/Summer2026-Internships |
| `newgrad` | SimplifyJobs/New-Grad-Positions |

A listing's identity is `(feed, sourceId)`, so ids only need to be unique within
one repo. The importer reads existing hashes once and writes only rows that are
new or genuinely changed, rather than upserting every row on every run.

Refresh manually with `npm run import`, or from the Refresh button in the
Listings tab.

## Verifying

```bash
cd job-tracker-backend
node scripts/verify.js              # core app behaviour
node scripts/verify-credentials.js  # API key encryption and isolation
```

The first exercises preferences, scoring, one-click apply, the full
change-detection lifecycle (snapshot → upstream edit → diff → dismiss → accept),
and the event history. The second covers the encryption round-trip, tamper
rejection, that no plaintext reaches the database, that two users never resolve
each other's keys, and the user → server → heuristic fallback order. Both use a
scratch user that is removed afterwards.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/applications` | List, with search / status / sort |
| `POST` | `/applications` | Add manually |
| `POST` | `/applications/from-listing/:id` | One-click apply |
| `PATCH` | `/applications/:id` | Update fields or status |
| `DELETE` | `/applications/:id` | Remove |
| `GET` | `/applications/analytics` | Charts and rates |
| `GET` | `/applications/updates` | Everything with a pending upstream edit |
| `GET` | `/applications/:id/upstream` | Field-by-field diff |
| `POST` | `/applications/:id/upstream/accept` | Pull the update in |
| `POST` | `/applications/:id/upstream/dismiss` | Keep your version |
| `GET` | `/listings` | Paginated feed, filters, sort by match |
| `GET` | `/listings/facets` | Distinct categories / terms / degrees |
| `GET` | `/listings/feeds` | Feed list with active counts |
| `POST` | `/listings/import` | Refresh all feeds |
| `GET`/`PUT` | `/preferences` | Read / save matching preferences |
| `POST` | `/match/run` | Start a background scoring run |
| `GET` | `/match/status` | Run progress and score coverage |
| `GET` | `/settings/api-key` | Key status — masked preview only, never the key |
| `PUT` | `/settings/api-key` | Verify against Anthropic, then encrypt and store |
| `DELETE` | `/settings/api-key` | Remove the stored key |

Every route except `/health`, `/listings/facets`, and `/listings/feeds` requires
a Clerk bearer token and is scoped to the signed-in user.
