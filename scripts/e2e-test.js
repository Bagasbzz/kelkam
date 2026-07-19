/*
  Simple end-to-end test script for local KeluhKampus dev server.
  Runs:
  - POST /api/research/chat (sample user message)
  - POST /api/research/search-plan (using brief)
  - For each query in the plan (or fallback), POST /api/references/search (providers)
  - Prints a JSON summary to stdout

  Usage: node scripts/e2e-test.js
*/
(async () => {
  try {
    const fetch = globalThis.fetch;
    const host = process.env.KELUH_HOST || "http://localhost:3000";

    function log(title, obj) {
      console.log("=== " + title + " ===");
      console.log(JSON.stringify(obj, null, 2));
    }

    // 1) Chat
    const chatResp = await fetch(`${host}/api/research/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: "Butuh makalah tentang sistem pengaduan mahasiswa, rentang 2018-2024, minimal 5 referensi"
          }
        ]
      })
    });
    const chatJson = await chatResp.json().catch(() => ({ success: false }));
    log("CHAT", chatJson);

    // 2) Search plan
    const brief = {
      title: "Sistem Pengaduan Mahasiswa",
      topic: "student complaint system",
      preferredKeywords: ["student complaint", "campus complaint"],
      yearRange: { start: 2018, end: 2024 },
      documentType: "paper"
    };
    const planResp = await fetch(`${host}/api/research/search-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brief })
    });
    const planJson = await planResp.json().catch(() => ({ success: false }));
    log("SEARCH_PLAN", planJson);

    // 3) Collect queries
    let queries = [];
    if (planJson?.success && Array.isArray(planJson.data)) {
      for (const g of planJson.data) {
        if (Array.isArray(g.queries)) {
          queries.push(...g.queries.slice(0, 4));
        }
      }
    }
    if (!queries.length) {
      queries = ['"student complaint system" AND (university OR campus)'];
    }

    // limit total queries to avoid long runs
    queries = queries.slice(0, 6);

    // 4) Run provider searches for each query
    const results = [];
    for (const q of queries) {
      const r = await fetch(`${host}/api/references/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, limit: 6, yearFrom: 2018, yearTo: 2024, providers: ["openalex", "semantic-scholar"] })
      }).catch((e) => ({ success: false, error: String(e) }));
      const jr = r && r.json ? await r.json().catch(() => ({ success: false })) : r;
      results.push({ query: q, response: jr });
      // polite delay
      await new Promise((res) => setTimeout(res, 600));
    }

    log("REFERENCE_SEARCH_RESULTS_SUMMARY", {
      totalQueries: queries.length,
      perQueryCounts: results.map((x) => ({ query: x.query, ok: x.response?.success, count: Array.isArray(x.response?.data) ? x.response.data.length : 0 }))
    });

    // Print full results optionally (commented to keep output small)
    // log("REFERENCE_SEARCH_RESULTS_FULL", results);

    process.exit(0);
  } catch (err) {
    console.error("E2E SCRIPT ERROR:", err);
    process.exit(2);
  }
})();