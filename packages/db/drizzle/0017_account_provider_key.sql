-- Keep this as ONE statement: the Neon HTTP migrator autocommits each call.
-- Stop all auth writers until this succeeds, its journal is verified, and every
-- auth node runs 1.7.7. The lock protects this statement, not later traffic.
DO $migration$
DECLARE
  duplicate_groups bigint;
BEGIN
  -- Bound lock acquisition; statement execution remains subject to the DB's
  -- statement_timeout. set_config(..., true) is transaction-local.
  PERFORM set_config('lock_timeout', '5s', true);
  LOCK TABLE "account" IN ACCESS EXCLUSIVE MODE;

  SELECT count(*) INTO duplicate_groups FROM (
    SELECT "provider_id", "account_id" FROM "account"
    GROUP BY "provider_id", "account_id" HAVING count(*) > 1
  ) AS duplicates;
  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION 'Better Auth upgrade blocked: % duplicate provider/account group(s)', duplicate_groups;
  END IF;

  -- Preserve every existing value. New SDK writes omit this legacy column.
  ALTER TABLE "account" ALTER COLUMN "issuer" DROP NOT NULL;
  -- A retry after DDL committed but journal insertion failed must be safe.
  DROP INDEX IF EXISTS "account_issuer_accountId_uidx";
END
$migration$;
