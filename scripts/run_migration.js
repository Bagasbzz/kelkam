/*
  Run SQL migration script against DATABASE_URL.
  Usage: node scripts/run_migration.js
  Requires environment variable DATABASE_URL (or .env.local with DATABASE_URL).
  WARNING: this will execute DDL on the target DB.
*/

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function run() {
  const sqlPath = path.join(__dirname, 'supabase_migrations', '001_create_reference_library.sql');
  if (!fs.existsSync(sqlPath)) {
    console.error('Migration file not found:', sqlPath);
    process.exit(2);
  }
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? null : null;
  const fromEnv = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

  if (!fromEnv) {
    console.error('DATABASE_URL or SUPABASE_DB_URL not set in environment. Please set DATABASE_URL to the postgres connection string.');
    process.exit(2);
  }

  const client = new Client({ connectionString: fromEnv });

  try {
    await client.connect();
    console.log('Connected to DB, running migration...');
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Migration executed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    try { await client.query('ROLLBACK'); } catch(_) {}
    process.exit(3);
  } finally {
    await client.end().catch(()=>{});
  }
}

run();