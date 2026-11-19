export interface Env {
  DB: D1Database;
  INGEST_TOKEN?: string;
  ASSETS?: Fetcher;
}

interface RunPayload {
  run: {
    id: string;
    commit_sha: string;
    commit_msg?: string;
    branch: string;
    trigger_source: string;
    ci_run_id?: string;
    ci_run_url?: string;
    runner_os?: string;
    total_tests: number;
    pass_count: number;
    fail_count: number;
    skip_count: number;
    error_count: number;
    unfixable_count: number;
    created_at?: string;
  };
  tests: Array<{
    utility: string;
    test_name: string;
    status: string;
    duration_ms?: number | null;
    is_unfixable?: boolean;
    is_intermittent?: boolean;
    log_excerpt?: string | null;
  }>;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return jsonResponse({ ok: true });
    }

    // Health check
    if (url.pathname === "/api/health") {
      return jsonResponse({ status: "healthy", timestamp: new Date().toISOString() });
    }

    // --- INGEST ENDPOINT ---
    if (url.pathname === "/api/ingest" && request.method === "POST") {
      const authHeader = request.headers.get("Authorization");
      const expectedToken = env.INGEST_TOKEN;

      if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
        return jsonResponse({ error: "Unauthorized. Ingestion token not configured or invalid." }, 401);
      }

      try {
        const payload = (await request.json()) as RunPayload;
        const { run, tests } = payload;

        if (!run || !run.id || !run.commit_sha) {
          return jsonResponse({ error: "Invalid payload: missing run metadata" }, 400);
        }

        // Insert or replace run
        await env.DB.prepare(`
          INSERT INTO runs (
            id, commit_sha, commit_msg, branch, trigger_source,
            ci_run_id, ci_run_url, runner_os, total_tests,
            pass_count, fail_count, skip_count, error_count,
            unfixable_count, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
          ON CONFLICT(id) DO UPDATE SET
            commit_sha=excluded.commit_sha,
            commit_msg=excluded.commit_msg,
            branch=excluded.branch,
            total_tests=excluded.total_tests,
            pass_count=excluded.pass_count,
            fail_count=excluded.fail_count,
            skip_count=excluded.skip_count,
            error_count=excluded.error_count,
            unfixable_count=excluded.unfixable_count
        `).bind(
          run.id,
          run.commit_sha,
          run.commit_msg || null,
          run.branch || "main",
          run.trigger_source || "local",
          run.ci_run_id || null,
          run.ci_run_url || null,
          run.runner_os || "Linux",
          run.total_tests || 0,
          run.pass_count || 0,
          run.fail_count || 0,
          run.skip_count || 0,
          run.error_count || 0,
          run.unfixable_count || 0,
          run.created_at || null
        ).run();

        // Remove any existing test results for this run
        await env.DB.prepare("DELETE FROM test_results WHERE run_id = ?").bind(run.id).run();

        // Batch insert test results in chunks of 50
        const chunkSize = 50;
        const insertStmt = env.DB.prepare(`
          INSERT INTO test_results (
            run_id, utility, test_name, status,
            duration_ms, is_unfixable, is_intermittent, log_excerpt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (let i = 0; i < tests.length; i += chunkSize) {
          const chunk = tests.slice(i, i + chunkSize);
          const batch = chunk.map((t) =>
            insertStmt.bind(
              run.id,
              t.utility,
              t.test_name,
              t.status,
              t.duration_ms ?? null,
              t.is_unfixable ? 1 : 0,
              t.is_intermittent ? 1 : 0,
              t.log_excerpt ?? null
            )
          );
          await env.DB.batch(batch);
        }

        return jsonResponse({
          success: true,
          run_id: run.id,
          tests_saved: tests.length,
        });
      } catch (err: any) {
        return jsonResponse({ error: err.message || "Failed to ingest test run" }, 500);
      }
    }

    // --- LIST RUNS ---
    if (url.pathname === "/api/runs" && request.method === "GET") {
      const branch = url.searchParams.get("branch");
      const os = url.searchParams.get("os");
      const limit = parseInt(url.searchParams.get("limit") || "50", 10);

      let query = "SELECT * FROM runs";
      const where: string[] = [];
      const params: any[] = [];

      if (branch) {
        where.push("branch = ?");
        params.push(branch);
      }
      if (os && os.toUpperCase() !== "ALL") {
        where.push("LOWER(runner_os) = LOWER(?)");
        params.push(os);
      }

      if (where.length > 0) {
        query += " WHERE " + where.join(" AND ");
      }

      query += " ORDER BY created_at DESC LIMIT ?";
      params.push(limit);

      const stmt = env.DB.prepare(query);
      const { results } = await stmt.bind(...params).all();

      return jsonResponse({ runs: results });
    }

    // --- LATEST RUN ---
    if (url.pathname === "/api/runs/latest" && request.method === "GET") {
      const branch = url.searchParams.get("branch") || "main";
      const os = url.searchParams.get("os");

      let query = "SELECT * FROM runs WHERE branch = ?";
      const params: any[] = [branch];

      if (os && os.toUpperCase() !== "ALL") {
        query += " AND LOWER(runner_os) = LOWER(?)";
        params.push(os);
      }

      query += " ORDER BY created_at DESC LIMIT 1";

      let result = await env.DB.prepare(query).bind(...params).first();

      if (!result) {
        // Fallback to any latest run
        result = await env.DB.prepare(
          "SELECT * FROM runs ORDER BY created_at DESC LIMIT 1"
        ).first();
      }

      if (!result) {
        return jsonResponse({ error: "No test runs found" }, 404);
      }

      return jsonResponse({ run: result });
    }

    // --- UTILITIES BREAKDOWN FOR A RUN ---
    const utilsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/utilities$/);
    if (utilsMatch && request.method === "GET") {
      const runId = decodeURIComponent(utilsMatch[1]);
      const { results } = await env.DB.prepare(`
        SELECT
          utility,
          COUNT(*) as total,
          SUM(CASE WHEN status = 'PASS' THEN 1 ELSE 0 END) as pass,
          SUM(CASE WHEN status = 'FAIL' THEN 1 ELSE 0 END) as fail,
          SUM(CASE WHEN status = 'SKIP' THEN 1 ELSE 0 END) as skip,
          SUM(CASE WHEN status = 'ERROR' THEN 1 ELSE 0 END) as error,
          SUM(CASE WHEN is_unfixable = 1 THEN 1 ELSE 0 END) as unfixable
        FROM test_results
        WHERE run_id = ?
        GROUP BY utility
        ORDER BY utility ASC
      `).bind(runId).all();

      return jsonResponse({ utilities: results });
    }

    // --- LIST TESTS FOR A RUN (WITH FILTERS & SEARCH) ---
    const testsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/tests$/);
    if (testsMatch && request.method === "GET") {
      const runId = decodeURIComponent(testsMatch[1]);
      const utility = url.searchParams.get("utility");
      const status = url.searchParams.get("status"); // comma-separated e.g. "FAIL,ERROR"
      const unfixable = url.searchParams.get("unfixable"); // "0", "1"
      const search = url.searchParams.get("search");
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);
      const offset = parseInt(url.searchParams.get("offset") || "0", 10);

      let whereClause = "WHERE run_id = ?";
      const params: any[] = [runId];

      if (utility) {
        whereClause += " AND utility = ?";
        params.push(utility);
      }

      if (status) {
        const statuses = status.split(",").map((s) => s.trim().toUpperCase());
        whereClause += ` AND status IN (${statuses.map(() => "?").join(",")})`;
        params.push(...statuses);
      }

      if (unfixable === "0") {
        whereClause += " AND is_unfixable = 0";
      } else if (unfixable === "1") {
        whereClause += " AND is_unfixable = 1";
      }

      if (search) {
        whereClause += " AND (test_name LIKE ? OR utility LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
      }

      const countRow = await env.DB.prepare(
        `SELECT COUNT(*) as count FROM test_results ${whereClause}`
      ).bind(...params).first<{ count: number }>();

      const totalMatches = countRow ? countRow.count : 0;

      const dataQuery = `
        SELECT id, run_id, utility, test_name, status, duration_ms, is_unfixable, is_intermittent, log_excerpt
        FROM test_results
        ${whereClause}
        ORDER BY
          CASE status
            WHEN 'FAIL' THEN 1
            WHEN 'ERROR' THEN 2
            WHEN 'SKIP' THEN 3
            WHEN 'PASS' THEN 4
            ELSE 5
          END,
          utility ASC,
          test_name ASC
        LIMIT ? OFFSET ?
      `;

      params.push(limit, offset);
      const { results } = await env.DB.prepare(dataQuery).bind(...params).all();

      return jsonResponse({
        total: totalMatches,
        limit,
        offset,
        tests: results,
      });
    }

    // --- COMPARE TWO RUNS (REGRESSIONS & FIXES) ---
    if (url.pathname === "/api/compare" && request.method === "GET") {
      const baseRunId = url.searchParams.get("base");
      const headRunId = url.searchParams.get("head");

      if (!baseRunId || !headRunId) {
        return jsonResponse({ error: "Missing required query parameters: base and head" }, 400);
      }

      const diffQuery = `
        SELECT
          COALESCE(h.utility, b.utility) as utility,
          COALESCE(h.test_name, b.test_name) as test_name,
          b.status as base_status,
          h.status as head_status,
          h.is_unfixable,
          h.log_excerpt
        FROM (SELECT * FROM test_results WHERE run_id = ?) b
        FULL OUTER JOIN (SELECT * FROM test_results WHERE run_id = ?) h
          ON b.utility = h.utility AND b.test_name = h.test_name
        WHERE b.status != h.status OR b.status IS NULL OR h.status IS NULL
      `;

      // SQLite in D1 supports LEFT JOIN / UNION for FULL OUTER JOIN if needed, or query both sets
      const baseTests = await env.DB.prepare(
        "SELECT utility, test_name, status FROM test_results WHERE run_id = ?"
      ).bind(baseRunId).all<{ utility: string; test_name: string; status: string }>();

      const headTests = await env.DB.prepare(
        "SELECT utility, test_name, status, is_unfixable, log_excerpt FROM test_results WHERE run_id = ?"
      ).bind(headRunId).all<{ utility: string; test_name: string; status: string; is_unfixable: number; log_excerpt: string | null }>();

      const baseMap = new Map<string, string>();
      for (const t of baseTests.results) {
        baseMap.set(`${t.utility}/${t.test_name}`, t.status);
      }

      const regressions: any[] = [];
      const fixes: any[] = [];
      const newlySkipped: any[] = [];

      for (const h of headTests.results) {
        const key = `${h.utility}/${h.test_name}`;
        const baseStatus = baseMap.get(key);

        if (baseStatus === "PASS" && (h.status === "FAIL" || h.status === "ERROR")) {
          regressions.push({
            utility: h.utility,
            test_name: h.test_name,
            before: baseStatus,
            after: h.status,
            log_excerpt: h.log_excerpt,
          });
        } else if ((baseStatus === "FAIL" || baseStatus === "ERROR") && h.status === "PASS") {
          fixes.push({
            utility: h.utility,
            test_name: h.test_name,
            before: baseStatus,
            after: h.status,
          });
        } else if (baseStatus === "PASS" && h.status === "SKIP") {
          newlySkipped.push({
            utility: h.utility,
            test_name: h.test_name,
            before: baseStatus,
            after: h.status,
          });
        }
      }

      return jsonResponse({
        base_run_id: baseRunId,
        head_run_id: headRunId,
        summary: {
          regressions_count: regressions.length,
          fixes_count: fixes.length,
          newly_skipped_count: newlySkipped.length,
        },
        regressions,
        fixes,
        newly_skipped: newlySkipped,
      });
    }

    // Fallback: If static assets binding is configured, pass to assets
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },
};
