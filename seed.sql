-- Sample test data for initial local dashboard visualization

INSERT OR REPLACE INTO runs (
    id, commit_sha, commit_msg, branch, trigger_source, total_tests,
    pass_count, fail_count, skip_count, error_count, unfixable_count, created_at
) VALUES (
    'run_sample_ref_1700000000',
    '8f4a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a',
    'cp: optimize copy_file_range fallback',
    'main',
    'local',
    30,
    22,
    4,
    2,
    2,
    3,
    DATETIME('now', '-1 day')
);

INSERT OR REPLACE INTO runs (
    id, commit_sha, commit_msg, branch, trigger_source, total_tests,
    pass_count, fail_count, skip_count, error_count, unfixable_count, created_at
) VALUES (
    'run_sample_latest_1700086400',
    'e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0',
    'tail: follow inotify fix and tests',
    'main',
    'local',
    30,
    25,
    2,
    2,
    1,
    3,
    DATETIME('now')
);

-- Test Results for Latest Run
INSERT INTO test_results (run_id, utility, test_name, status, is_unfixable, is_intermittent, log_excerpt) VALUES
('run_sample_latest_1700086400', 'cp', 'abuse.sh', 'PASS', 0, 0, NULL),
('run_sample_latest_1700086400', 'cp', 'fail-perm.sh', 'PASS', 0, 0, NULL),
('run_sample_latest_1700086400', 'cp', 'preserve-link.sh', 'PASS', 0, 0, NULL),
('run_sample_latest_1700086400', 'cp', 'sparse.sh', 'PASS', 0, 0, NULL),
('run_sample_latest_1700086400', 'cp', 'nfs-removal-race.sh', 'SKIP', 1, 0, 'Skipped: requires GNU specific stat libc interposition'),
('run_sample_latest_1700086400', 'cp', 'reflink-perm.sh', 'FAIL', 0, 0, '+ cp --reflink=always file1 file2
cp: failed to clone file1 from file2: Operation not supported
+ test -f file2
FAIL: tests/cp/reflink-perm.sh (exit status: 1)'),

('run_sample_latest_1700086400', 'ls', 'color-norm.sh', 'PASS', 0, 0, NULL),
('run_sample_latest_1700086400', 'ls', 'dired.sh', 'PASS', 0, 0, NULL),
('run_sample_latest_1700086400', 'ls', 'follow-slink.sh', 'PASS', 0, 0, NULL),
('run_sample_latest_1700086400', 'ls', 'inode.sh', 'PASS', 0, 0, NULL),
('run_sample_latest_1700086400', 'ls', 'stat-dtype.sh', 'FAIL', 0, 0, '+ ls -f
ls: cannot access directory entries in raw order
FAIL: tests/ls/stat-dtype.sh (exit status: 1)'),

('run_sample_latest_1700086400', 'tail', 'inotify-race.sh', 'SKIP', 1, 0, 'Skipped: gdb breakpoint in GNU C source not supported'),
('run_sample_latest_1700086400', 'tail', 'inotify-race2.sh', 'SKIP', 1, 0, 'Skipped: gdb breakpoint in GNU C source not supported'),
('run_sample_latest_1700086400', 'tail', 'follow-stdin.sh', 'PASS', 0, 0, NULL),
('run_sample_latest_1700086400', 'tail', 'pipe-f.sh', 'PASS', 0, 0, NULL),

('run_sample_latest_1700086400', 'touch', 'read-only.sh', 'PASS', 0, 0, NULL),
('run_sample_latest_1700086400', 'touch', 'relative.sh', 'PASS', 0, 0, NULL),
('run_sample_latest_1700086400', 'touch', 'now-pkg.sh', 'PASS', 0, 0, NULL),

('run_sample_latest_1700086400', 'sort', 'sort-u.sh', 'PASS', 0, 0, NULL),
('run_sample_latest_1700086400', 'sort', 'sort-numeric.sh', 'PASS', 0, 0, NULL),
('run_sample_latest_1700086400', 'sort', 'sort-float.sh', 'ERROR', 0, 1, 'sort: out of memory allocating buffer
ERROR: tests/sort/sort-float.sh (exit status: 2)'),

('run_sample_latest_1700086400', 'rm', 'r-root.sh', 'SKIP', 1, 0, 'Skipped: gdb breakpoint in GNU C source'),
('run_sample_latest_1700086400', 'rm', 'i-no-r.sh', 'PASS', 0, 0, NULL),
('run_sample_latest_1700086400', 'rm', 'empty-name.sh', 'PASS', 0, 0, NULL),

('run_sample_latest_1700086400', 'dd', 'misc.sh', 'PASS', 0, 0, NULL),
('run_sample_latest_1700086400', 'dd', 'bytes.sh', 'PASS', 0, 0, NULL),
('run_sample_latest_1700086400', 'dd', 'not-rewound.sh', 'PASS', 0, 0, NULL);
