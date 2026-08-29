# KeluhKampus migration runbook

Status: **prepared, not executed**. Tidak ada migration pada folder ini yang dijalankan ke Supabase production selama implementasi Studio.

## Urutan final

1. `001_create_reference_library.sql` (atau varian `001_create_reference_library_with_rls.sql`, pilih satu saja).
2. `002_create_projects_table.sql`.
3. `003_create_evidence_table.sql`.
4. `supabase/report_jobs.sql`.
5. `004_secure_multitenant_tables.sql`.
6. `005_secure_waitlist.sql`.
7. `006_create_project_studio.sql`.

Jangan menjalankan dua varian migration `001` bersamaan. File `004` adalah containment yang mengubah policy tabel yang sudah ada; review row lama yang `owner_id`-nya belum dapat dipetakan sebelum membuka akses.

## Sebelum eksekusi

- Pastikan backup database dan titik pemulihan sudah diverifikasi.
- Catat schema snapshot: tabel, policy RLS, grants, index, dan jumlah baris.
- Pastikan `projects.project_id` dan `projects.owner_id` sudah terisi benar untuk seluruh data aktif.
- Pastikan tidak ada row `reference_library`, `reference_evidence`, atau `report_jobs` orphan yang akan membutuhkan backfill.
- Jalankan SQL sebagai database owner/migration role, bukan `anon` atau `authenticated`.
- Deploy API yang sudah memakai ownership guard setelah policy final tersedia.
- Uji pada Supabase preview/staging dengan salinan anonymized terlebih dahulu.

## Validasi sesudah eksekusi

Jalankan query read-only berikut di staging/production setelah migration selesai:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'projects', 'reference_library', 'reference_evidence', 'report_jobs', 'waitlist',
    'studio_projects', 'studio_sources', 'studio_questions', 'studio_decisions',
    'studio_artifacts', 'studio_project_revisions'
  )
order by tablename;

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename like 'studio_%'
order by tablename, policyname;

select count(*) as orphan_studio_projects
from public.studio_projects sp
left join public.projects p on p.project_id = sp.project_id
where p.project_id is null;
```

Application negative tests wajib membuktikan bahwa user A tidak dapat `select`, `insert`, `update`, atau `delete` row milik user B pada semua tabel Studio. Uji juga bahwa `waitlist` hanya insert dan tidak dapat dienumerasi.

## Backfill dan sync Studio

Project Studio sekarang memakai localStorage versioned agar pengguna dapat brainstorming tanpa menunggu migrasi DB. Setelah migration final:

- jangan otomatis menimpa local workspace dengan row database;
- tawarkan pilihan `local lebih baru`, `database lebih baru`, atau `compare and merge` berdasarkan `revision`/`updated_at`;
- kirim sumber dan keputusan dengan idempotency key;
- simpan snapshot ke `studio_project_revisions` sebelum merge;
- baru aktifkan sync default setelah conflict, offline retry, dan ownership test lolos.

## Rollback

Rollback tidak boleh dilakukan dengan `drop table` spontan. Pulihkan backup bila migration inti gagal. Untuk migration 006, hentikan sync baru, pertahankan tabel untuk investigasi, dan rollback aplikasi ke local-only mode. Jika benar-benar perlu, gunakan migration rollback terpisah yang sudah direview untuk menghapus policy/index/tabel setelah snapshot diekspor; jangan menghapus payload Studio tanpa arsip.

## Definition of done

- Semua tabel memiliki RLS aktif dan tidak ada grant `anon` yang tidak diperlukan.
- Query lintas owner mengembalikan nol row dan mutation lintas owner ditolak.
- Build/deploy API ownership guard dan test golden Studio lolos.
- Local-to-DB conflict flow terdokumentasi dan diuji.
- Backup, schema snapshot, dan hasil negative test disimpan bersama release record.
