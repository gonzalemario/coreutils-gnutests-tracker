-- D1 Database Schema for GNU Test Suite Tracker

-- 1. Test Runs Table
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,                       -- e.g. run_abc1234_1700000000
    commit_sha TEXT NOT NULL,                  -- Git commit hash
    commit_msg TEXT,                           -- First line of commit message
    branch TEXT NOT NULL DEFAULT 'main',       -- Branch name
    trigger_source TEXT NOT NULL DEFAULT 'local', -- 'local', 'ci'
    ci_run_id TEXT,                            -- GitHub Actions run ID (if applicable)
    ci_run_url TEXT,                           -- Direct URL to CI run
    runner_os TEXT DEFAULT 'Linux',            -- OS environment
    total_tests INTEGER NOT NULL DEFAULT 0,
    pass_count INTEGER NOT NULL DEFAULT 0,
    fail_count INTEGER NOT NULL DEFAULT 0,
    skip_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    unfixable_count INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_runs_branch ON runs(branch, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_commit ON runs(commit_sha);

-- 2. Test Results Table
CREATE TABLE IF NOT EXISTS test_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    utility TEXT NOT NULL,                     -- e.g. 'cp', 'ls', 'sort', 'touch'
    test_name TEXT NOT NULL,                   -- e.g. 'fail-perm.sh', 'abuse.sh'
    status TEXT NOT NULL,                      -- 'PASS', 'FAIL', 'SKIP', 'ERROR'
    duration_ms INTEGER,                       -- Execution time in ms
    is_unfixable BOOLEAN NOT NULL DEFAULT 0,   -- 1 if in gnu-unfixable-tests.txt
    is_intermittent BOOLEAN NOT NULL DEFAULT 0,-- 1 if in ignore-intermittent.txt
    log_excerpt TEXT,                          -- Tail of failure log (50-100 lines)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_test_results_run_util ON test_results(run_id, utility, status);
CREATE INDEX IF NOT EXISTS idx_test_results_run_status ON test_results(run_id, status);
CREATE INDEX IF NOT EXISTS idx_test_results_name ON test_results(test_name);
