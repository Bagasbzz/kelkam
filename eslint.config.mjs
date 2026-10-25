import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["scripts/**/*.js", "server.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  // Anti SQL injection: raw SQL hanya boleh lewat tagged template `$queryRaw`/`$executeRaw`
  // (parameter otomatis di-bind). Varian "Unsafe" & Prisma.raw menerima string mentah.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-properties": ["error",
        { property: "$queryRawUnsafe", message: "Dilarang: rawan SQL injection. Pakai prisma.$queryRaw`...${param}`." },
        { property: "$executeRawUnsafe", message: "Dilarang: rawan SQL injection. Pakai prisma.$executeRaw`...${param}`." },
        { object: "Prisma", property: "raw", message: "Dilarang: Prisma.raw menyisipkan string mentah ke SQL. Pakai Prisma.sql`...`." },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "deploy/**",
  ]),
]);

export default eslintConfig;
