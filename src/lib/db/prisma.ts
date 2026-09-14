/**
 * src/lib/db/prisma.ts
 * -----------------------------------------------------------------------------
 * Prisma client singleton.
 *
 * Di dev mode (Next.js dev server dengan HMR), module ini bisa di-import
 * berulang kali. Tanpa singleton, tiap import bikin connection pool baru →
 * cepat-cepat DB connection limit habis (PostgreSQL default max 100 conn).
 *
 * Pattern: attach ke globalThis supaya HMR tidak duplicate instance.
 *
 * `log` levels:
 *   - development: query + error + warn (untuk debugging SQL)
 *   - production: error saja (sebagian besar)
 *
 * Pakai:
 *   import { prisma } from "@/lib/db/prisma";
 *   const users = await prisma.user.findMany();
 * -----------------------------------------------------------------------------
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;