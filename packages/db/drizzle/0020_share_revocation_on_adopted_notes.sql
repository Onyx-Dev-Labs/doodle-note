-- Public share links on legacy meeting rows must stay revocable after sync v2
-- adoption, and must die when the note is trashed. The legacy guard used to
-- reject every write to an adopted meeting row, including "turn sharing off".
-- Every statement here is idempotent so a retried Neon HTTP migration is safe.
CREATE OR REPLACE FUNCTION sync_guard_legacy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org text; nid uuid; seq bigint; lib uuid;
BEGIN
  IF TG_OP='DELETE' THEN org:=OLD.organization_id; nid:=OLD.id; ELSE org:=NEW.organization_id; nid:=NEW.id; END IF;
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM organization WHERE id=org) THEN RETURN OLD; END IF;
  seq:=sync_next_sequence(org);
  IF TG_OP='UPDATE' AND OLD.organization_id<>NEW.organization_id THEN RAISE EXCEPTION 'sync_owner_immutable'; END IF;
  IF EXISTS(SELECT 1 FROM sync_notes WHERE id=nid) THEN
    IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM sync_notes WHERE id=nid AND organization_id=org AND state='purged') THEN RETURN OLD; END IF;
    -- Share settings are web-owned metadata, not synced content: allow an update
    -- that changes nothing but them (and the bookkeeping timestamp).
    IF TG_OP='UPDATE' AND
       (to_jsonb(NEW) - 'share_token' - 'share_expires_at' - 'share_include_transcript' - 'updated_at') =
       (to_jsonb(OLD) - 'share_token' - 'share_expires_at' - 'share_include_transcript' - 'updated_at') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'sync_upgrade_required';
  END IF;
  IF TG_OP='DELETE' THEN
    lib:=md5('doodlenote-legacy:'||org)::uuid;
    INSERT INTO sync_libraries(id,organization_id) VALUES(lib,org) ON CONFLICT DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM sync_libraries WHERE id=lib AND organization_id=org) THEN RAISE EXCEPTION 'sync_library_conflict'; END IF;
    INSERT INTO sync_notes(id,library_id,organization_id,state) VALUES(nid,lib,org,'purged');
    INSERT INTO sync_revisions(note_id,organization_id,sequence,kind) VALUES(nid,org,seq,'purge');
    RETURN OLD;
  END IF;
  NEW.updated_at:=date_trunc('milliseconds',greatest(clock_timestamp(),COALESCE((SELECT max(updated_at)+interval '1 millisecond' FROM meetings WHERE organization_id=org),clock_timestamp())));
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_revoke_share_on_trash() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE meetings SET share_token=NULL, share_expires_at=NULL, share_include_transcript=false
    WHERE id=NEW.id AND organization_id=NEW.organization_id AND share_token IS NOT NULL;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS sync_revoke_share_on_trash ON sync_notes;
--> statement-breakpoint
CREATE TRIGGER sync_revoke_share_on_trash AFTER UPDATE OF state ON sync_notes
  FOR EACH ROW WHEN (NEW.state IN ('trashed','purged') AND OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION sync_revoke_share_on_trash();
