import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function expect(relativePath, pattern, message) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    failures.push(`${relativePath}: file not found`);
    return;
  }
  const content = read(relativePath);
  if (!pattern.test(content)) failures.push(`${relativePath}: ${message}`);
}

function reject(relativePath, pattern, message) {
  if (!fs.existsSync(path.join(root, relativePath))) return;
  const content = read(relativePath);
  if (pattern.test(content)) failures.push(`${relativePath}: ${message}`);
}

function collectTypeScriptFiles(relativeDirectory) {
  if (!fs.existsSync(path.join(root, relativeDirectory))) return [];
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

expect("prisma/schema.prisma", /model\s+User\b/, "User model is missing");
expect("prisma/schema.prisma", /passwordHash\s+String/, "password hash field is missing");
expect("prisma/schema.prisma", /model\s+Project\b/, "Project model is missing");
expect("prisma/schema.prisma", /ownerId\s+String/, "owner_id scoping is missing");
expect("prisma/schema.prisma", /model\s+StudioProject\b/, "StudioProject model is missing");
expect("prisma/schema.prisma", /model\s+FileUpload\b/, "FileUpload model is missing");

reject("src/app/api/context/extract/route.ts", /\.env(\.|$)/i, "env files in readable extension list");
expect("src/app/api/context/extract/route.ts", /MAX_ZIP_UNCOMPRESSED_BYTES/, "ZIP expansion limit is missing");
expect("src/app/api/report-jobs/status/[jobId]/route.ts", /authenticateRequestFromCookie/, "job status route is not authenticated");
expect("src/lib/server/auth.ts", /argon2/, "argon2 password hashing is missing");
expect("src/lib/server/auth.ts", /jwtVerify/, "JWT verification is missing");
expect("src/proxy.ts", /matcher:\s*\[/, "proxy matcher is missing");
expect("next.config.ts", /Content-Security-Policy/, "security headers are missing");
expect("next.config.ts", /output:\s*"standalone"/, "Next.js standalone output is not configured");
expect("server.js", /createServer/, "custom Next.js server entry is missing");
expect("public/.htaccess", /RewriteRule/, "Apache reverse proxy is missing");

if (failures.length) {
  console.error("Security baseline check failed:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Security baseline check passed (${syntaxFiles.length} TypeScript files + policy assertions).`);