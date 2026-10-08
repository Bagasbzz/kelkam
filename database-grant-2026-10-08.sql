-- Jalankan di cPanel → phpPgAdmin → keluhkam_kamp → SQL (login sebagai keluhkam).
-- Memberi hak akses tabel hasil hotfix 2026-10-08 ke semua role aplikasi (keluhkam_*),
-- lalu mengatur default privilege agar tabel/sequence baru otomatis bisa diakses.
BEGIN;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT rolname FROM pg_roles
    WHERE rolname LIKE 'keluhkam%' AND rolname <> current_user AND rolcanlogin
  LOOP
    EXECUTE format('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO %I', r.rolname);
    EXECUTE format('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO %I', r.rolname);
    EXECUTE format('GRANT USAGE, CREATE ON SCHEMA public TO %I', r.rolname);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO %I', r.rolname);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO %I', r.rolname);
  END LOOP;
END $$;

COMMIT;

-- Verifikasi: siapa pemilik tabel & role yang ada
SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
