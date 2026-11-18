#!/usr/bin/env python3
"""
GNU Test Suite Result Extractor and Ingest Client
=================================================
Extracts individual GNU test results from local test runs or CI runs,
extracts failure logs (with configurable tail line count), flags unfixable
and intermittent tests, and uploads or exports the structured payload.

Supports:
- Local runs from `./util/run-gnu-test.sh`
- GitHub Actions CI runs
- Direct POST to Cloudflare Worker API or export to JSON file
"""

import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path


def detect_os() -> str:
    """Detect current operating system with support for Android, BSDs, Windows, etc."""
    if os.environ.get("TARGET_OS"):
        return os.environ.get("TARGET_OS")
    if os.environ.get("ANDROID_ROOT") or os.path.exists("/system/build.prop"):
        return "Android"
    if os.environ.get("RUNNER_OS"):
        val = os.environ.get("RUNNER_OS").strip()
        if val.lower() == "macos":
            return "macOS"
        return val.capitalize()

    plat = sys.platform.lower()
    if plat.startswith("linux"):
        return "Linux"
    elif plat.startswith("freebsd"):
        return "FreeBSD"
    elif plat.startswith("openbsd"):
        return "OpenBSD"
    elif plat.startswith("netbsd"):
        return "NetBSD"
    elif plat.startswith("win32") or plat.startswith("cygwin") or plat.startswith("msys"):
        return "Windows"
    elif plat.startswith("darwin"):
        return "macOS"
    return "Linux"

    """Retrieve git metadata (commit, branch, message)."""
    def _run(cmd):
        try:
            return subprocess.check_output(cmd, cwd=repo_dir, text=True, stderr=subprocess.DEVNULL).strip()
        except Exception:
            return ""

    commit_sha = os.environ.get("GITHUB_SHA") or _run(["git", "rev-parse", "HEAD"]) or "unknown-commit"
    branch = os.environ.get("GITHUB_REF_NAME") or _run(["git", "rev-parse", "--abbrev-ref", "HEAD"]) or "main"
    commit_msg = os.environ.get("GITHUB_COMMIT_MSG") or _run(["git", "log", "-1", "--pretty=%s"]) or "Local test run"

    ci_run_id = os.environ.get("GITHUB_RUN_ID", "")
    ci_server_url = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
    ci_repository = os.environ.get("GITHUB_REPOSITORY", "uutils/coreutils")
    ci_run_url = f"{ci_server_url}/{ci_repository}/actions/runs/{ci_run_id}" if ci_run_id else ""

    trigger_source = "github_actions" if os.environ.get("CI") else "local"

    return {
        "commit_sha": commit_sha,
        "branch": branch,
        "commit_msg": commit_msg,
        "trigger_source": trigger_source,
        "ci_run_id": ci_run_id,
        "ci_run_url": ci_run_url,
    }


def load_list_file(file_path: str) -> set:
    """Load line-delimited items from file, skipping comments and blank lines."""
    items = set()
    if file_path and os.path.exists(file_path):
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    # Normalize: e.g. "cp/fail-perm.log" -> "tests/cp/fail-perm"
                    cleaned = line.replace(".log", "").replace(".sh", "").replace(".pl", "")
                    if cleaned.startswith("tests/"):
                        cleaned = cleaned[len("tests/"):]
                    items.add(cleaned)
    return items


def extract_log_excerpt(file_path: Path, max_lines: int) -> str:
    """Extract the last N lines of a test log file, cleaning control chars."""
    if not file_path.is_file():
        return ""
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        tail = lines[-max_lines:] if len(lines) > max_lines else lines
        # Clean ANSI escape sequences
        ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
        cleaned_lines = [ansi_escape.sub('', line) for line in tail]
        return "".join(cleaned_lines)
    except Exception as e:
        return f"Error reading log: {e}"


def scan_gnu_test_results(test_dir: Path, log_lines: int, unfixable_set: set, intermittent_set: set):
    """Walk test directory and extract test results."""
    results = []
    status_regex = re.compile(r"(PASS|FAIL|SKIP|ERROR) [^ ]+ \(exit status: (\d+)\)$")

    total_tests = 0
    counts = {"PASS": 0, "FAIL": 0, "SKIP": 0, "ERROR": 0, "UNFIXABLE": 0}

    # Find all .log files in the test directory
    for log_path in test_dir.glob("**/*.log"):
        # We only care about tests under <util>/<test>.log or tests/<util>/<test>.log
        rel_path = log_path.relative_to(test_dir)
        parts = rel_path.parts
        if not parts:
            continue

        # Skip top-level logs like test-suite.log
        if len(parts) == 1:
            continue

        utility = parts[0]
        test_filename = parts[-1]
        test_base = test_filename.replace(".log", "")
        test_key = f"{utility}/{test_base}"

        status = "UNKNOWN"
        duration_ms = None
        log_excerpt = None

        try:
            with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()

            match = status_regex.search(content)
            if match:
                status = match.group(1)
            elif "PASS" in content[-200:]:
                status = "PASS"
            elif "FAIL" in content[-200:]:
                status = "FAIL"
            elif "SKIP" in content[-200:]:
                status = "SKIP"
            else:
                status = "ERROR"

        except Exception as e:
            status = "ERROR"
            log_excerpt = f"Failed to read file: {e}"

        is_unfixable = test_key in unfixable_set
        is_intermittent = test_key in intermittent_set

        if status in ("FAIL", "ERROR") and log_excerpt is None:
            log_excerpt = extract_log_excerpt(log_path, log_lines)

        counts[status] = counts.get(status, 0) + 1
        if is_unfixable:
            counts["UNFIXABLE"] += 1
        total_tests += 1

        results.append({
            "utility": utility,
            "test_name": test_filename,
            "status": status,
            "duration_ms": duration_ms,
            "is_unfixable": is_unfixable,
            "is_intermittent": is_intermittent,
            "log_excerpt": log_excerpt,
        })

    return results, counts, total_tests


def upload_payload(endpoint: str, payload: dict, token: str = None):
    """POST the json payload to the Cloudflare Worker API."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=data,
        headers={"Content-Type": "application/json", "User-Agent": "gnu-test-exporter/1.0"},
        method="POST"
    )
    if token:
        req.add_header("Authorization", f"Bearer {token}")

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
            print(f"Successfully uploaded run to {endpoint}: HTTP {resp.status}")
            print(f"Response: {body}")
            return True
    except urllib.error.HTTPError as e:
        print(f"HTTP Error {e.code}: {e.read().decode('utf-8', errors='ignore')}", file=sys.stderr)
        return False
    except urllib.error.URLError as e:
        print(f"Network error uploading results: {e.reason}", file=sys.stderr)
        return False


def main():
    parser = argparse.ArgumentParser(description="Export GNU test results to JSON or Cloudflare Worker API.")
    parser.add_argument("--test-dir", default="../gnu/tests", help="Path to GNU test directory containing .log files")
    parser.add_argument("--coreutils-dir", default=".", help="Path to coreutils repo (for git metadata and unfixable lists)")
    parser.add_argument("--log-lines", type=int, default=75, help="Number of tail log lines to include for failed tests (default: 75)")
    parser.add_argument("--unfixable-file", help="Path to gnu-unfixable-tests.txt")
    parser.add_argument("--intermittent-file", help="Path to ignore-intermittent.txt")
    parser.add_argument("--os", help="Target operating system (e.g. Linux, FreeBSD, OpenBSD, Windows, macOS, Android)")
    parser.add_argument("--source", choices=["local", "github_actions", "ci"], help="Explicitly specify trigger source")
    parser.add_argument("--output", "-o", help="Output file path to save payload JSON")
    parser.add_argument("--endpoint", help="Cloudflare Worker /api/ingest URL to upload results directly")
    parser.add_argument("--token", help="Bearer authorization token for the Worker API")

    args = parser.parse_args()

    coreutils_path = Path(args.coreutils_dir).resolve()
    test_dir_path = Path(args.test_dir).resolve()

    if not test_dir_path.exists():
        print(f"Error: test directory does not exist: {test_dir_path}", file=sys.stderr)
        sys.exit(1)

    # Resolve unfixable and intermittent files
    unfixable_path = args.unfixable_file or (coreutils_path / "util" / "gnu-unfixable-tests.txt")
    intermittent_path = args.intermittent_file or (coreutils_path / ".github" / "workflows" / "ignore-intermittent.txt")

    unfixable_set = load_list_file(str(unfixable_path))
    intermittent_set = load_list_file(str(intermittent_path))

    git_info = get_git_info(str(coreutils_path))
    if args.source:
        git_info["trigger_source"] = args.source

    results, counts, total = scan_gnu_test_results(
        test_dir_path,
        log_lines=args.log_lines,
        unfixable_set=unfixable_set,
        intermittent_set=intermittent_set
    )

    runner_os = args.os if args.os else detect_os()
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    run_id = f"run_{git_info['commit_sha'][:8]}_{runner_os.lower()}_{int(datetime.datetime.now().timestamp())}"

    payload = {
        "run": {
            "id": run_id,
            "commit_sha": git_info["commit_sha"],
            "commit_msg": git_info["commit_msg"],
            "branch": git_info["branch"],
            "trigger_source": git_info["trigger_source"],
            "ci_run_id": git_info["ci_run_id"],
            "ci_run_url": git_info["ci_run_url"],
            "runner_os": runner_os,
            "total_tests": total,
            "pass_count": counts.get("PASS", 0),
            "fail_count": counts.get("FAIL", 0),
            "skip_count": counts.get("SKIP", 0),
            "error_count": counts.get("ERROR", 0),
            "unfixable_count": counts.get("UNFIXABLE", 0),
            "created_at": now_iso,
        },
        "tests": results,
    }

    print("=" * 60)
    print(" GNU Test Suite Results Summary")
    print("=" * 60)
    print(f" Commit:     {git_info['commit_sha'][:10]} ({git_info['branch']})")
    print(f" OS:         {runner_os}")
    print(f" Source:     {git_info['trigger_source']}")
    print(f" Total:      {total}")
    print(f" PASS:       {counts.get('PASS', 0)} ({counts.get('PASS', 0) / max(1, total) * 100:.1f}%)")
    print(f" FAIL:       {counts.get('FAIL', 0)}")
    print(f" SKIP:       {counts.get('SKIP', 0)}")
    print(f" ERROR:      {counts.get('ERROR', 0)}")
    print(f" Unfixable:  {counts.get('UNFIXABLE', 0)}")
    print("=" * 60)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
        print(f"Saved payload to: {args.output}")

    if args.endpoint:
        upload_payload(args.endpoint, payload, args.token)


if __name__ == "__main__":
    main()
