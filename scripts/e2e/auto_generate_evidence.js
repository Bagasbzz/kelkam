/*
  Quick E2E verification script (service-role) that:
  - ensures project mapping exists
  - picks one reference from reference_library for project proj_local_1 (or any)
  - creates a simple auto-generated evidence row (simulated AI) and inserts it
  - verifies insertion

  Usage: node scripts/e2e/auto_generate_evidence.js
  Requires .env.local with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
*/

const fs = require("fs");
const path = require("path");

// Load .env.local (lightweight) - try multiple candidate locations (repo root, scripts dir)
try {
  const candidates = [
    path.join(__dirname, "..", ".env.local"), // scripts/.env.local (if placed there)
    path.join(__dirname, "..", "..", ".env.local"), // repo /.env.local
    path.join(__dirname, ".env.local"),
  ];
  for (const envPath of candidates) {
    try {
      if (!envPath) continue;
      if (fs.existsSync(envPath)) {
        const env = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
        for (const line of env) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eq = trimmed.indexOf("=");
          if (eq === -1) continue;
          const key = trimmed.slice(0, eq).trim();
          let val = trimmed.slice(eq + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!(key in process.env)) process.env[key] = val;
        }
        break;
      }
    } catch {
      // try next candidate
    }
  }
} catch (e) {
  // ignore
}

const { createClient } = require("@supabase/supabase-js");

async function run() {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
    process.exit(2);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const projectId = (process.env.E2E_PROJECT_ID) || "proj_local_1";

  try {
    console.log("Ensuring project mapping exists...");
    await supabase.from("projects").upsert({ project_id: projectId, owner_id: "service-e2e" }, { onConflict: "project_id" });

    console.log("Fetching a reference for project (if any)...");
    const { data: refs, error: refsErr } = await supabase
      .from("reference_library")
      .select("*")
      .eq("project_id", projectId)
      .limit(1);

    if (refsErr) {
      console.error("Failed fetching reference:", refsErr);
      process.exit(3);
    }

    let reference = refs && refs.length ? refs[0] : null;
    if (!reference) {
      console.log("No reference found for project, inserting a dummy reference...");
      const sampleRef = {
        id: "sample-ref-e2e",
        project_id: projectId,
        title: "E2E Sample Reference",
        authors: ["Test Author"],
        year: 2026,
        doi: "sample:e2e:001",
        url: "https://example.com",
      };
      const { data: insRef } = await supabase.from("reference_library").insert(sampleRef).select("*").maybeSingle();
      reference = insRef;
      console.log("Inserted sample reference:", reference.id);
    } else {
      console.log("Using reference:", reference.id || reference.reference_id || reference.title);
    }

    // Simulate AI generation (simple templated summary)
    const summary = `Auto-generated summary for "${reference.title || reference.id}". This is a placeholder summary created during E2E verification.`;
    const evidenceRow = {
      project_id: projectId,
      reference_id: reference.doi || reference.id || reference.reference_id || "sample-ref-e2e",
      summary,
      methods: "Auto-detected methods (simulated)",
      results: "Auto-detected results (simulated)",
      limitations: "Auto-detected limitations (simulated)",
      keywords: ["auto", "e2e", "simulated"],
      citation_sentence: `${(reference.authors && reference.authors[0]) || "Author"} (${reference.year || "n.d."}) shows ...`,
      model_used: "FAST-SIM",
    };

    const { data: ev, error: evErr } = await supabase.from("reference_evidence").insert(evidenceRow).select("*").limit(1).maybeSingle();
    if (evErr) {
      console.error("Failed inserting evidence:", evErr);
      process.exit(4);
    }
    console.log("Inserted evidence row id:", ev.id);

    // Verify count
    const { data: list, error: listErr } = await supabase.from("reference_evidence").select("id", { count: "exact" }).eq("project_id", projectId);
    if (listErr) {
      console.error("Failed counting evidence:", listErr);
    } else {
      console.log("Total evidence rows for project:", Array.isArray(list) ? list.length : "unknown");
    }

    console.log("E2E simulated generation complete.");
    process.exit(0);
  } catch (err) {
    console.error("Unexpected error:", err);
    process.exit(10);
  }
}

run();