-- =====================================================================
-- 0012 — Allow appending a document version under RLS.
--
-- WHY THIS MIGRATION EXISTS
--
-- 0007 enabled row level security on public.document_versions and gave
-- it exactly one policy: document_versions_select. RLS denies by
-- default, so with no INSERT policy the table is readable and
-- permanently unwritable by any RLS-scoped client. Version history
-- could be displayed and never appended to.
--
-- The alternatives were worse. Writing versions through the service
-- role would bypass row level security for an ordinary user action —
-- the service role is reserved for the audit trail and approval
-- resolution, where there is no user session to scope by. Widening that
-- to routine writes would remove the database-level guarantee that a
-- member cannot touch another business's records, and replace it with
-- an application-level check that a future bug can skip.
--
-- So this adds the smallest thing that makes the existing tables
-- usable: one INSERT policy, mirroring the scope test the SELECT policy
-- already performs. No new table, no new column, no new concept.
--
-- WHAT IS DELIBERATELY NOT ADDED
--
-- No UPDATE policy and no DELETE policy. Their absence is not an
-- oversight to be tidied up later — it is the append-only guarantee,
-- enforced by the database rather than by convention. A historical
-- version cannot be edited into something it never was, and cannot be
-- removed to hide that it existed. Application code could promise the
-- same thing and would stop promising it the first time someone added
-- an "edit note" button.
--
-- Correcting a mistake therefore means appending a new version, which
-- is also what honestly happened.
-- =====================================================================

drop policy if exists document_versions_insert on public.document_versions;
create policy document_versions_insert on public.document_versions
  for insert with check (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and public.can_access_scoped(d.organization_id, d.business_id)
        -- Mirrors the SELECT policy: a restricted document stays
        -- PRIME-only, so nobody can append to a document they are not
        -- permitted to read.
        and (d.classification <> 'restricted' or public.is_prime(d.organization_id))
    )
  );
