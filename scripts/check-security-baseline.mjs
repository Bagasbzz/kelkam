import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function expect(relativePath, pattern, message) {
  const content = read(relativePath);
  if (!pattern.test(content)) failures.push(`${relativePath}: ${message}`);
}

function reject(relativePath, pattern, message) {
  const content = read(relativePath);
  if (pattern.test(content)) failures.push(`${relativePath}: ${message}`);
}

function collectTypeScriptFiles(relativeDirectory) {
  return fs.readdirSync(path.join(root, relativeDirectory), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name).replace(/\\/g, "/");
    if (entry.isDirectory()) return collectTypeScriptFiles(relativePath);
    return /\.tsx?$/.test(entry.name) ? [relativePath] : [];
  });
}

const syntaxFiles = [...collectTypeScriptFiles("src"), "next.config.ts"];

for (const relativePath of syntaxFiles) {
  const result = ts.transpileModule(read(relativePath), {
    fileName: relativePath,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  for (const diagnostic of result.diagnostics || []) {
    if (diagnostic.category === ts.DiagnosticCategory.Error) {
      failures.push(`${relativePath}: TypeScript syntax diagnostic ${diagnostic.code}`);
    }
  }
}

expect("supabase/report_jobs.sql", /owner_id\s*=\s*auth\.uid\(\)::text/i, "report jobs must be owner-scoped");
reject("supabase/report_jobs.sql", /using\s*\(true\)|with\s+check\s*\(true\)/i, "permissive RLS policy detected");
expect("scripts/supabase_migrations/004_secure_multitenant_tables.sql", /reference_library_owner_all/i, "tenant RLS migration is missing");
expect("scripts/supabase_migrations/005_secure_waitlist.sql", /grant insert on public\.waitlist/i, "waitlist insert-only grant is missing");
reject("src/app/api/context/extract/route.ts", /txt\|md\|csv\|json[^\n]*\|env\|/i, ".env is still in the readable extension list");
expect("src/app/api/context/extract/route.ts", /MAX_ZIP_UNCOMPRESSED_BYTES/, "ZIP expansion limit is missing");
expect("src/app/api/report-jobs/status/[jobId]/route.ts", /authenticateRequest\(req\)/, "job status route is not authenticated");
expect("src/lib/report/report-jobs.ts", /\.eq\("owner_id", ownerId\)/, "job queries are not owner-filtered");
expect("src/proxy.ts", /matcher:\s*\["\/api\/:path\*"\]/, "API gateway matcher is missing");
expect("next.config.ts", /Content-Security-Policy/, "security headers are missing");

if (failures.length) {
  console.error("Security baseline check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Security baseline check passed (${syntaxFiles.length} TypeScript files + policy assertions).`);
