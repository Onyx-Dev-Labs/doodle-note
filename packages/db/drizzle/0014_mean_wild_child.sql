CREATE TABLE "ink_cleanup" (
	"path" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ink_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"attachment_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"library_id" uuid NOT NULL,
	"generation" uuid NOT NULL,
	"manifest" jsonb NOT NULL,
	"uploaded" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ink_versions" ADD CONSTRAINT "ink_versions_note_id_sync_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."sync_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION ink_path(v uuid, part text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT 'private-ink/' || v::text || '/' || part;
$$;
--> statement-breakpoint
CREATE FUNCTION ink_enqueue(v uuid, org text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO ink_cleanup(path,organization_id) VALUES (ink_path(v,'ink'),org),(ink_path(v,'preview'),org)
 ON CONFLICT(path) DO UPDATE SET next_attempt_at=now(),deleted_at=null;
END $$;
--> statement-breakpoint
CREATE FUNCTION ink_remove_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM ink_enqueue(OLD.id,OLD.organization_id); RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER ink_remove BEFORE DELETE ON ink_versions FOR EACH ROW EXECUTE FUNCTION ink_remove_trigger();
--> statement-breakpoint
CREATE FUNCTION ink_note_purge_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state='purged' AND OLD.state<>'purged' THEN DELETE FROM ink_versions WHERE note_id=NEW.id; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ink_note_purge AFTER UPDATE OF state ON sync_notes FOR EACH ROW EXECUTE FUNCTION ink_note_purge_trigger();
--> statement-breakpoint
CREATE FUNCTION ink_revision_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ref jsonb;
BEGIN
 FOR ref IN SELECT value FROM jsonb_array_elements(coalesce(NEW.snapshot->'inkAttachments','[]'::jsonb)) LOOP
  IF NOT EXISTS(SELECT 1 FROM ink_versions v JOIN sync_notes n ON n.id=v.note_id
   WHERE v.id=(ref->>'versionId')::uuid AND v.attachment_id=(ref->>'id')::uuid
    AND v.note_id=NEW.note_id AND v.organization_id=NEW.organization_id AND v.library_id=n.library_id
    AND n.state='active' AND v.state='ready') THEN
   RAISE EXCEPTION 'invalid_ink_reference' USING ERRCODE='23514';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ink_revision BEFORE INSERT OR UPDATE OF snapshot ON sync_revisions FOR EACH ROW EXECUTE FUNCTION ink_revision_trigger();
--> statement-breakpoint
CREATE FUNCTION ink_reserve(org text, m jsonb) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n sync_notes; v ink_versions;
BEGIN
 PERFORM sync_next_sequence(org);
 SELECT * INTO n FROM sync_notes WHERE id=(m->>'noteId')::uuid AND organization_id=org AND library_id=(m->>'libraryId')::uuid FOR UPDATE;
 IF NOT FOUND THEN RETURN 'not_found'; END IF;
 IF n.state<>'active' OR n.lifecycle_generation<>(m->>'generation')::uuid THEN RETURN 'lifecycle_conflict'; END IF;
 SELECT * INTO v FROM ink_versions WHERE id=(m->>'versionId')::uuid;
 IF FOUND THEN
  IF v.organization_id=org AND v.note_id=n.id AND v.manifest=m THEN RETURN v.state; END IF;
  RETURN 'version_reused';
 END IF;
 IF EXISTS(SELECT 1 FROM ink_cleanup WHERE path=ink_path((m->>'versionId')::uuid,'ink')) THEN RETURN 'retired'; END IF;
 IF n.head_revision IS DISTINCT FROM (m->>'expectedRevision')::uuid THEN RETURN 'revision_conflict'; END IF;
 INSERT INTO ink_versions(id,attachment_id,note_id,organization_id,library_id,generation,manifest)
 VALUES ((m->>'versionId')::uuid,(m->>'attachmentId')::uuid,n.id,org,n.library_id,n.lifecycle_generation,m) ON CONFLICT(id) DO NOTHING;
 SELECT * INTO v FROM ink_versions WHERE id=(m->>'versionId')::uuid;
 IF v.organization_id<>org OR v.note_id<>n.id OR v.manifest<>m THEN RETURN 'version_reused'; END IF;
 -- A conflicting owner's deletion may have committed while INSERT waited.
 IF EXISTS(SELECT 1 FROM ink_cleanup WHERE path=ink_path(v.id,'ink')) THEN
  DELETE FROM ink_versions WHERE id=v.id; RETURN 'retired';
 END IF;
 RETURN 'pending';
END $$;
--> statement-breakpoint
CREATE FUNCTION ink_uploaded(org text, version uuid, part text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v ink_versions; n sync_notes;
BEGIN
 PERFORM sync_next_sequence(org);
 SELECT * INTO v FROM ink_versions WHERE id=version AND organization_id=org;
 IF NOT FOUND THEN
  UPDATE ink_cleanup SET next_attempt_at=now(),deleted_at=null WHERE path=ink_path(version,part) AND organization_id=org;
  RETURN 'retired';
 END IF;
 SELECT * INTO n FROM sync_notes WHERE id=v.note_id FOR UPDATE;
 IF n.state<>'active' OR n.lifecycle_generation<>v.generation OR v.created_at<now()-interval '24 hours' AND v.state='pending' THEN
  DELETE FROM ink_versions WHERE id=version AND state='pending'; RETURN 'lifecycle_conflict';
 END IF;
 IF part NOT IN ('ink','preview') THEN RETURN 'invalid_part'; END IF;
 UPDATE ink_versions SET uploaded=uploaded||jsonb_build_object(part,true) WHERE id=version;
 UPDATE ink_versions SET state='ready' WHERE id=version AND uploaded @> '{"ink":true,"preview":true}'::jsonb;
 SELECT state INTO v.state FROM ink_versions WHERE id=version; RETURN v.state;
END $$;
--> statement-breakpoint
CREATE FUNCTION ink_collect(org text DEFAULT NULL) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n sync_notes; v ink_versions; count integer:=0;
BEGIN
 IF org IS NULL THEN RETURN 0; END IF;
 IF NOT EXISTS(SELECT 1 FROM organization WHERE id=org) THEN RETURN 0; END IF;
 PERFORM sync_next_sequence(org);
 -- Same workspace mutex/order as sync_apply. Bounded per call, revisited hourly.
 FOR n IN SELECT * FROM sync_notes WHERE state='trashed' AND expires_at<=now() AND (org IS NULL OR organization_id=org) ORDER BY organization_id,id LIMIT 50 LOOP
  PERFORM sync_expire(n.organization_id,n.library_id);
 END LOOP;
 FOR v IN SELECT candidate.* FROM ink_versions candidate WHERE (org IS NULL OR candidate.organization_id=org) AND created_at<now()-interval '24 hours'
  AND NOT EXISTS(SELECT 1 FROM sync_revisions r WHERE r.note_id=candidate.note_id AND r.snapshot->'inkAttachments' @> jsonb_build_array(jsonb_build_object('id',candidate.attachment_id,'versionId',candidate.id)))
  ORDER BY candidate.organization_id,candidate.id LIMIT 100 LOOP
  PERFORM sync_next_sequence(v.organization_id);
  -- Recheck after taking the mutex: a revision may have committed while waiting.
  IF NOT EXISTS(SELECT 1 FROM sync_revisions r WHERE r.note_id=v.note_id AND r.snapshot->'inkAttachments' @> jsonb_build_array(jsonb_build_object('id',v.attachment_id,'versionId',v.id))) THEN
   DELETE FROM ink_versions WHERE id=v.id; count:=count+1;
  END IF;
 END LOOP;
 RETURN count;
END $$;
