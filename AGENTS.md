# GNU Test Tracker: Agent Onboarding & Context Guide

> **Target Audience:** AI coding agents and autonomous assistants starting a new session in this workspace.  
> **Repository:** `coreutils-gnutests-tracker` (root workspace)  
> **External Target Project:** [uutils/coreutils](https://github.com/uutils/coreutils) (mounted at `/coreutils` in container)  
> **Stack:** Cloudflare Workers (TypeScript) + Cloudflare D1 (Serverless SQLite) + Static HTML/Tailwind + Python 3 CLI + Podman  
> **Language Standard:** **British English** (e.g. *centralised*, *initialise*, *behaviour*, *colour*, *analyse*). All agents must strictly use British spelling in documentation, code comments, commit messages, and communications.

---

## 1. Project Purpose & Core Architecture

This project is a **centralised**, zero-cost dashboard and ingestion API designed to track GNU test suite compliance for the Rust rewrite of coreutils (`uutils/coreutils`).

### Key Objectives
1. **Centralised Visibility:** Aggregate test results from local developer runs (`./util/run-gnu-test.sh` in the `uutils/coreutils` repository) and CI (`GnuTests.yml` in `uutils/coreutils`).
2. **Actionable Triage ("What's Missing?"):** Distinguish real actionable bugs from structural skips (`util/gnu-unfixable-tests.txt` in the `uutils/coreutils` repository) and flaky tests (`.github/workflows/ignore-intermittent.txt` in `uutils/coreutils`).
3. **Instant Debugging:** Store and surface syntax-cleaned tail excerpts (50–100 lines) of failure logs directly in the browser UI without digging through CI artifacts or raw log files.
4. **Regression Tracking:** Side-by-side run comparison (`/api/compare`) highlighting newly broken tests (regressions) and newly passing tests (fixes).
5. **Zero-Cost Free Tier Hosting:** Runs entirely within Cloudflare's free quotas (Workers + D1 SQLite + Pages/Assets).

---

## 2. Directory Layout & Repository Scope

### Tracker Repository (`coreutils-gnutests-tracker`)
```text
├── Containerfile              # Debian Bookworm container with Node 22 LTS, Python 3, Wrangler
├── dev.sh                     # Helper script to launch the container with volume mounts & port forwards
├── schema.sql                 # D1 SQLite schema (runs and test_results tables + indexes)
├── seed.sql                   # Realistic sample data for local UI and API preview
├── wrangler.toml              # Cloudflare Worker config, D1 binding (DB), static assets directory
├── package.json               # Scripts: dev, db:init, db:seed, deploy
├── backend/
│   └── src/
│       └── index.ts           # Worker REST API (ingest, runs, tests, utilities, compare)
├── frontend/
│   └── public/
│       └── index.html         # Responsive dashboard (Tailwind CSS, vanilla JS, modal diff viewer)
├── scripts/
│   └── export_gnu_results.py  # Result parser CLI: reads test logs from coreutils, extracts tail logs, posts to API
├── AGENTS.md                  # Agent onboarding guide and guidelines (this file)
└── README.md                  # Human-facing user and deployment guide
```

### External Coreutils Repository (`uutils/coreutils`)
> [!NOTE]
> The following files and directories belong to the **external `uutils/coreutils` repository** (mounted into the dev container at `/coreutils` or located locally on the host):
> - `./util/run-gnu-test.sh` — The test execution script inside `coreutils`.
> - `tests/**/*.log` (or `../gnu/tests/**/*.log`) — Test logs generated when running the GNU test suite against `coreutils`.
> - `util/gnu-unfixable-tests.txt` — List of tests known to be structurally unfixable in `coreutils`.
> - `.github/workflows/ignore-intermittent.txt` — List of known flaky/intermittent tests in `coreutils`.

---

## 3. Database Schema (Cloudflare D1 SQLite)

The schema in `schema.sql` manages two primary tables:

1. **`runs`**:
   - `id`: Unique run identifier (e.g. `run_<sha8>_<os>_<timestamp>`).
   - `commit_sha`, `commit_msg`, `branch`, `trigger_source` (`local`, `ci`).
   - `runner_os`: Target OS (`Linux`, `FreeBSD`, `OpenBSD`, `Windows`, `macOS`, `Android`).
   - `pass_count`, `fail_count`, `skip_count`, `error_count`, `unfixable_count`, `total_tests`.
   - `ci_run_id`, `ci_run_url`.

2. **`test_results`**:
   - `run_id`: Foreign key referencing `runs(id)` on cascade delete.
   - `utility`: Name of utility under test (`cp`, `ls`, `sort`, `touch`, etc.).
   - `test_name`: Test script filename (e.g. `fail-perm.sh`, `abuse.sh`).
   - `status`: One of `PASS`, `FAIL`, `SKIP`, `ERROR`.
   - `is_unfixable`: Boolean (1 if test is listed in `gnu-unfixable-tests.txt` from `coreutils`).
   - `is_intermittent`: Boolean (1 if listed in `ignore-intermittent.txt` from `coreutils`).
   - `log_excerpt`: Tail excerpt of failure output with ANSI colour escapes stripped.

---

## 4. API Specification

| Method | Endpoint | Description & Query Parameters |
| :--- | :--- | :--- |
| `POST` | `/api/ingest` | Ingests `{ run: {...}, tests: [...] }`. Header: `Authorization: Bearer <INGEST_TOKEN>`. Chunks insertions into 50-row batches. |
| `GET` | `/api/runs` | List recent runs. Filters: `?branch=main&os=Linux&limit=50`. |
| `GET` | `/api/runs/latest` | Get the latest run. Filters: `?branch=main&os=Linux`. |
| `GET` | `/api/runs/:id/utilities` | Per-utility statistics breakdown (`total`, `pass`, `fail`, `skip`, `error`, `unfixable`). |
| `GET` | `/api/runs/:id/tests` | Query tests. Filters: `?utility=cp&status=FAIL,ERROR&unfixable=0&search=keyword&limit=100&offset=0`. |
| `GET` | `/api/compare` | Compares two runs: `?base=<id>&head=<id>`. Returns `{ regressions: [...], fixes: [...], newly_skipped: [...] }`. |
| `GET` | `/api/health` | Simple health check returning `{ status: "healthy" }`. |

---

## 5. Development Workflow & Commands

### Running in Podman (Recommended)
```bash
# Launch container shell with project at /app and coreutils at /coreutils
./dev.sh

# Inside container (or host with Node + Wrangler installed):
npm run db:init      # Apply schema.sql to local D1 SQLite
npm run db:seed      # Populate realistic sample data
npm run dev          # Start local dev server at http://localhost:8787
```

### Ingesting GNU Test Logs
```bash
# From the tracker repository root:
python3 scripts/export_gnu_results.py \
  --test-dir /path/to/coreutils/../gnu/tests \
  --coreutils-dir /path/to/coreutils \
  --log-lines 75 \
  --endpoint http://localhost:8787/api/ingest \
  --token local-dev-secret
```

### Deploying to Cloudflare Free Tier
```bash
wrangler login
wrangler d1 create coreutils_tests
# Update wrangler.toml with the returned database_id
wrangler d1 execute coreutils_tests --remote --file=schema.sql
wrangler deploy
```

---

## 6. Critical Invariants & Rules for Agents

1. **British English Spelling Standard:**
   - Always use British English spelling across all documentation, code comments, commit messages, and communications (e.g. *centralised*, *initialise*, *behaviour*, *colour*, *optimise*, *prioritise*, *analyse*).

2. **D1 SQLite Limits & Batching:**
   - D1 free tier has a maximum of 100,000 writes/day.
   - When executing batch inserts, always chunk inserts in groups of 50 to avoid SQLite parameter limit errors.
   - D1 does not support PostgreSQL `FULL OUTER JOIN`; in `/api/compare`, joins or set diffs must remain compatible with SQLite or be performed in JavaScript.

3. **External Coreutils Repository Separation:**
   - Remember that test execution scripts (`run-gnu-test.sh`), test logs (`.log`), and exclusion lists (`gnu-unfixable-tests.txt`, `ignore-intermittent.txt`) reside in `uutils/coreutils`. Do not create or expect them in the tracker repository root.

4. **Unfixable Tests Logic:**
   - Adjusted Pass Rate must be computed as:
     $$\text{Adjusted Pass Rate} = \frac{\text{PASS}}{\text{Total} - \text{SKIP} - \text{UNFIXABLE}}$$
   - Always verify that `is_unfixable` is properly populated from `gnu-unfixable-tests.txt`.

5. **Log Sanitisation:**
   - Failure logs stored in `log_excerpt` must always have ANSI escape codes stripped using regex `\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])`.

6. **Security & Secrets:**
   - Default dev secret: `local-dev-secret`.
   - Never commit production tokens to Git; production tokens are injected via `wrangler secret put INGEST_TOKEN`.
