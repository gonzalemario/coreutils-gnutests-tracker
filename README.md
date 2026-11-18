# GNU Coreutils Test Suite Tracker & Dashboard

A central, zero-cost dashboard and tracking API for [uutils/coreutils](https://github.com/uutils/coreutils) GNU test suite compliance.

Hosted on **Cloudflare Free Tier** (Cloudflare Workers + D1 Serverless SQLite + Cloudflare Pages/Assets).

---

## Features

- **Centralized Test Status Matrix**: Visualizes all tests across ~100 core utilities.
- **"What's Missing?" Actionable View**: Filters directly to failing tests while excluding structural skips from `gnu-unfixable-tests.txt`.
- **Inline Failure Logs**: One-click expandable syntax-highlighted failure logs (configurable 50–100 lines tail) so you don't need to dig through raw terminal logs.
- **Per-Utility Progress Bars**: Visual completion percentages (e.g. `touch 100%`, `cp 86%`).
- **Regression & Fix Inspector**: Side-by-side diff between any two runs to immediately see newly broken tests vs new fixes.
- **Podman Containerized Environment**: Self-contained development with Node.js 22 LTS, Python 3, and Cloudflare Wrangler.

---

## Quick Start (Podman)

### 1. Launch the Container
Run the included helper script from the repository root:
```bash
./dev.sh
```
This mounts this project to `/app`, mounts your `coreutils` repo read-only to `/coreutils`, and forwards ports:
- `8787`: Wrangler Dev Server (API & Web Dashboard)
- `5173`: Vite Dev Server (if needed)

### 2. Initialize the Local SQLite Database
Inside the container (or via `./dev.sh <command>`):
```bash
# Initialize schema in local D1 SQLite
npm run db:init

# (Optional) Seed with sample test data to test the dashboard immediately
npm run db:seed
```

### 3. Start the Local Server
```bash
npm run dev
```
Open **[http://localhost:8787](http://localhost:8787)** in your browser!

---

## Ingesting GNU Test Results

The CLI script `scripts/export_gnu_results.py` extracts test results, maps unfixable/flaky tests, extracts failure logs, and uploads them to the dashboard API.

### Ingesting Local Test Results
After running tests via `./util/run-gnu-test.sh` in your coreutils workspace:
```bash
python3 scripts/export_gnu_results.py \
  --test-dir /coreutils/../gnu/tests \
  --coreutils-dir /coreutils \
  --log-lines 75 \
  --endpoint http://localhost:8787/api/ingest \
  --token local-dev-secret
```

Options:
- `--log-lines N`: Configurable number of failure log lines to include (default: 75).
- `--source local`: Tag the run as local (or `ci` for CI).
- `-o payload.json`: Save the structured JSON without uploading.
- `--token SECRET`: Bearer token for authentication.

---

## Cloudflare Free-Tier Deployment

When ready to host publicly on Cloudflare:

1. **Log in to Cloudflare**:
   ```bash
   wrangler login
   ```

2. **Create the Production D1 Database**:
   ```bash
   wrangler d1 create coreutils_tests
   ```
   Copy the `database_id` output by Wrangler into your `wrangler.toml`.

3. **Apply the Database Schema to Cloudflare**:
   ```bash
   wrangler d1 execute coreutils_tests --remote --file=schema.sql
   ```

4. **Deploy**:
   ```bash
   wrangler deploy
   ```

Your dashboard and ingestion API will now be live on your `*.workers.dev` domain with permanent free tier limits (5M database reads/day, 100k writes/day, 5 GB storage).

---

## Project Structure

```text
├── Containerfile              # Podman container definition
├── dev.sh                     # Helper script to run podman with volume mounts & ports
├── schema.sql                 # Cloudflare D1 SQLite database schema
├── seed.sql                   # Sample test runs and test results
├── wrangler.toml              # Cloudflare Worker configuration & D1 binding
├── package.json               # Node.js dependencies & scripts
├── backend/
│   └── src/
│       └── index.ts           # Worker REST API (ingest, runs, tests, compare)
├── frontend/
│   └── public/
│       └── index.html         # Responsive web dashboard UI
└── scripts/
    └── export_gnu_results.py  # Test log extractor and ingest client
```
