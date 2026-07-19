/*
  Simple verification script that uses SERVICE_ROLE key to:
  - insert a project mapping (projects table)
  - insert a sample reference_evidence row
  - query and print the inserted rows/counts

  Usage: node scripts/e2e/insert_sample_evidence.js
  Requires .env.local with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (already set)
*/

const fs = require("fs");
const path = require("path");
// lightweight .env.local loader (avoid requiring dotenv)
try {
  const envPath = path.join(__dirname, "..", "..", ".env.local");
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
  }
} catch (e) {
  // ignore loader errors; process.env may already be set
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

  const projectId = "proj_local_1";
  const owner_id = "service-test"; // synthetic owner id for verification

  try {
    console.log("Inserting project mapping (if not exists)...");
    const { data: proj, error: projErr } = await supabase
      .from("projects")
      .upsert({ project_id: projectId, owner_id }, { onConflict: "project_id" })
      .select("*")
      .limit(1)
      .maybeSingle();

    if (projErr) {
      console.error("Project upsert error:", projErr);
      process.exit(3);
    }
    console.log("Project row:", proj);

    console.log("Inserting sample evidence...");
    const sample = {
      project_id: projectId,
      reference_id: "sample-ref-001",
      summary: "Sample summary created by verification script.",
      methods: "Sample methods",
      results: "Sample results",
      limitations: "Sample limitations",
      keywords: ["sample", "evidence", "test"],
      citation_sentence: "Sample Author (2026) reports sample results.",
      model_used: "FAST",
    };

    const { data: ev, error: evErr } = await supabase
      .from("reference_evidence")
      .insert(sample)
      .select("*")
      .limit(1)
      .maybeSingle();

    if (evErr) {
      console.error("Evidence insert error:", evErr);
      process.exit(4);
    }
    console.log("Inserted evidence row:", ev);

    console.log("Counting evidence rows for project...");
    const { data: countRes, error: countErr } = await supabase
      .from("reference_evidence")
      .select("id", { count: "exact", head: false })
      .eq("project_id", projectId);

    if (countErr) {
      console.error("Count query error:", countErr);
      process.exit(5);
    }
    console.log("Evidence rows for project:", Array.isArray(countRes) ? countRes.length : "unknown");

    console.log("Verification complete.");
    process.exit(0);
  } catch (err) {
    console.error("Unexpected error:", err);
    process.exit(10);
  }
}

run();