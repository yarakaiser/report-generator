-- ============================================================================
-- setup-readonly-role.sql
-- ----------------------------------------------------------------------------
-- Creates a READ-ONLY PostgreSQL login role for the Calyx report generator.
--
-- The report tool must NEVER write to the POS database. This role enforces
-- that at the database level, independent of the application code, so a bug
-- (or a compromised tool) physically cannot INSERT/UPDATE/DELETE or run DDL.
--
-- Enforcement layers (defence in depth):
--   1. Role has ONLY the SELECT privilege (no INSERT/UPDATE/DELETE/DDL).
--   2. default_transaction_read_only = on  -> every session refuses writes.
--   3. Application never calls .insert()/.update()/.delete() (Kysely).
--
-- HOW TO RUN (as a superuser or the database owner):
--   psql -U postgres -d calyx_pos -f setup-readonly-role.sql
--
-- BEFORE RUNNING:
--   * Change the placeholder password below (:'ro_password' default).
--   * Adjust the database name (calyx_pos) and schema list if yours differ.
--
-- This script is idempotent: safe to re-run. It (re)grants privileges and
-- creates the role only if it does not already exist.
-- ============================================================================

\set ON_ERROR_STOP on

-- ----------------------------------------------------------------------------
-- Configuration -- override on the command line with -v, e.g.:
--   psql -v ro_user=calyx_readonly -v ro_password='S3cret!' -v db_name=calyx_pos -f setup-readonly-role.sql
-- ----------------------------------------------------------------------------
\if :{?ro_user}     \else \set ro_user     calyx_readonly     \endif
\if :{?ro_password} \else \set ro_password 'change-me-strong' \endif
\if :{?db_name}     \else \set db_name     calyx_pos          \endif

-- Schemas the report tool reads from. `pos` is the core reporting data;
-- `posreporting` holds the log tables (storno, internal consumption, etc.);
-- `poslog` holds the partitioned financial log. Add/remove as needed.
--   NOTE: schema names are hard-coded in the GRANT statements below because
--   GRANT ... IN SCHEMA does not accept psql variables for the schema list.
--   If your schema set differs, edit the three GRANT/ALTER blocks accordingly.

-- ----------------------------------------------------------------------------
-- 1. Create the login role if it does not already exist, and make it
--    read-only at the session level.
--
--    NOTE: we use `\gexec` (not a DO $$...$$ block) because psql does NOT
--    substitute :variables inside dollar-quoted strings -- the body would be
--    sent to the server verbatim and fail. With \gexec the format(...) call
--    lives in plain SQL, so :'ro_user'/:'ro_password' are interpolated first,
--    then the generated CREATE/ALTER statement is executed.
-- ----------------------------------------------------------------------------

-- Create the role only if it does not exist yet (idempotent).
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'ro_user', :'ro_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'ro_user')
\gexec

-- Ensure login + refresh the password on every run so the script stays
-- authoritative even if the role already existed.
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'ro_user', :'ro_password')
\gexec

-- Every transaction this role opens is read-only by default -> writes refused.
ALTER ROLE :"ro_user" SET default_transaction_read_only = on;

-- ----------------------------------------------------------------------------
-- 2. Let the role reach the database and the report schemas.
-- ----------------------------------------------------------------------------
GRANT CONNECT ON DATABASE :"db_name" TO :"ro_user";
GRANT USAGE ON SCHEMA pos, posreporting, poslog TO :"ro_user";

-- ----------------------------------------------------------------------------
-- 3. SELECT on all EXISTING tables and views in those schemas.
-- ----------------------------------------------------------------------------
GRANT SELECT ON ALL TABLES IN SCHEMA pos, posreporting, poslog TO :"ro_user";
GRANT SELECT ON ALL SEQUENCES IN SCHEMA pos, posreporting, poslog TO :"ro_user";

-- ----------------------------------------------------------------------------
-- 4. SELECT on tables/views created in the FUTURE, so new report data is
--    readable without re-running this script. Applies to objects created by
--    the object owner(s); if tables are created by multiple roles you may need
--    to run ALTER DEFAULT PRIVILEGES FOR ROLE <owner> for each.
-- ----------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA pos, posreporting, poslog
  GRANT SELECT ON TABLES TO :"ro_user";
ALTER DEFAULT PRIVILEGES IN SCHEMA pos, posreporting, poslog
  GRANT SELECT ON SEQUENCES TO :"ro_user";

-- ----------------------------------------------------------------------------
-- Done. Verify manually (should SUCCEED):
--   psql "postgresql://calyx_readonly:...@HOST:5432/calyx_pos" \
--     -c "SELECT count(*) FROM pos.invoices;"
--
-- And this should FAIL with 'permission denied' / 'read-only transaction':
--   psql "postgresql://calyx_readonly:...@HOST:5432/calyx_pos" \
--     -c "CREATE TABLE pos.should_not_work (x int);"
-- ----------------------------------------------------------------------------
