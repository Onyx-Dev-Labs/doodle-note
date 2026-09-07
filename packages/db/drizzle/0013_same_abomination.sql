CREATE TABLE "sync_clocks" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"sequence" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_libraries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"library_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"head_revision" uuid,
	"lifecycle_generation" uuid DEFAULT gen_random_uuid() NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"deletion_id" uuid,
	"deleted_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sync_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"note_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"receipt" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"parent_id" uuid,
	"kind" text NOT NULL,
	"snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_clocks" ADD CONSTRAINT "sync_clocks_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_libraries" ADD CONSTRAINT "sync_libraries_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_notes" ADD CONSTRAINT "sync_notes_library_id_sync_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."sync_libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_notes" ADD CONSTRAINT "sync_notes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_note_id_sync_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."sync_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_revisions" ADD CONSTRAINT "sync_revisions_note_id_sync_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."sync_notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_revisions" ADD CONSTRAINT "sync_revisions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_revisions_org_sequence" ON "sync_revisions" USING btree ("organization_id","sequence");--> statement-breakpoint
CREATE FUNCTION sync_next_sequence(org text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE result bigint;
BEGIN
  INSERT INTO sync_clocks(organization_id,sequence) VALUES(org,0) ON CONFLICT DO NOTHING;
  UPDATE sync_clocks SET sequence=sequence+1 WHERE organization_id=org RETURNING sequence INTO result;
  RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION sync_apply(org text, operation jsonb, payload_hash text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  lib uuid := (operation->>'libraryId')::uuid;
  nid uuid := (operation->>'noteId')::uuid;
  opid uuid := (operation->>'operationId')::uuid;
  expected uuid := (operation->>'expectedRevision')::uuid;
  generation uuid := (operation->>'expectedLifecycleGeneration')::uuid;
  action text := operation->>'kind';
  n sync_notes%ROWTYPE; previous sync_operations%ROWTYPE;
  revision uuid := gen_random_uuid(); seq bigint; result jsonb; legacy jsonb; event_kind text;
BEGIN
  -- Clock lock is also the workspace mutation mutex, held until transaction commit.
  seq := sync_next_sequence(org);
  IF EXISTS(SELECT 1 FROM sync_libraries WHERE id=lib AND organization_id<>org)
    OR EXISTS(SELECT 1 FROM sync_notes WHERE id=nid AND (organization_id<>org OR library_id<>lib))
    OR EXISTS(SELECT 1 FROM meetings WHERE id=nid AND organization_id<>org) THEN
    RETURN jsonb_build_object('status','not_found');
  END IF;
  SELECT * INTO previous FROM sync_operations WHERE id=opid;
  IF FOUND THEN
    IF previous.organization_id<>org OR previous.note_id<>nid OR previous.payload_hash<>payload_hash THEN
      RETURN jsonb_build_object('status','operation_reused');
    END IF;
    IF EXISTS(SELECT 1 FROM sync_notes WHERE id=nid AND state='purged') THEN
      RETURN jsonb_build_object('status','purged','noteId',nid);
    END IF;
    RETURN previous.receipt;
  END IF;
  IF action='upsert' THEN
    IF operation->'snapshot'->>'folderId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM folders WHERE id=(operation->'snapshot'->>'folderId')::uuid AND organization_id=org) THEN RETURN jsonb_build_object('status','invalid_folder'); END IF;
  END IF;
  SELECT * INTO n FROM sync_notes WHERE id=nid;
  IF NOT FOUND THEN
    IF action<>'upsert' OR expected IS NOT NULL OR generation IS NOT NULL THEN
      RETURN jsonb_build_object('status','not_found');
    END IF;
    INSERT INTO sync_libraries(id,organization_id) VALUES(lib,org) ON CONFLICT DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM sync_libraries WHERE id=lib AND organization_id=org) THEN RETURN jsonb_build_object('status','not_found'); END IF;
    -- Snapshot every old-client field and every segment before claiming this record.
    SELECT jsonb_build_object('legacyMeeting',to_jsonb(m),'legacyNotes',
      (SELECT to_jsonb(nt) FROM notes nt WHERE nt.meeting_id=m.id),'legacySegments',
      COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY start_ms,id) FROM transcript_segments t WHERE meeting_id=m.id),'[]'::jsonb))
      INTO legacy FROM meetings m WHERE id=nid AND organization_id=org FOR UPDATE;
    INSERT INTO sync_notes(id,library_id,organization_id) VALUES(nid,lib,org) RETURNING * INTO n;
    IF legacy IS NOT NULL THEN
      INSERT INTO sync_revisions(id,note_id,organization_id,sequence,kind,snapshot) VALUES(revision,nid,org,seq,'legacy',legacy);
      UPDATE sync_notes SET head_revision=revision WHERE id=nid RETURNING * INTO n;
      revision:=gen_random_uuid(); seq:=sync_next_sequence(org);
      generation:=n.lifecycle_generation;
    ELSE
      generation:=n.lifecycle_generation;
    END IF;
  END IF;
  -- Server clock alone decides expiration. Purge also removes all retained content.
  IF n.state='trashed' AND n.expires_at<=clock_timestamp() THEN
    UPDATE sync_notes SET state='purged',lifecycle_generation=gen_random_uuid() WHERE id=nid RETURNING * INTO n;
    UPDATE sync_revisions SET snapshot=NULL WHERE note_id=nid;
    DELETE FROM meetings WHERE id=nid AND organization_id=org;
    INSERT INTO sync_revisions(id,note_id,organization_id,sequence,kind) VALUES(revision,nid,org,seq,'purge');
  END IF;
  IF n.state='purged' THEN RETURN jsonb_build_object('status','purged','noteId',nid); END IF;
  IF generation IS DISTINCT FROM n.lifecycle_generation THEN
    RETURN jsonb_build_object('status','lifecycle_conflict','headRevision',n.head_revision,'lifecycleGeneration',n.lifecycle_generation);
  END IF;
  IF expected IS NOT NULL AND NOT EXISTS(SELECT 1 FROM sync_revisions WHERE id=expected AND note_id=nid AND organization_id=org) THEN RETURN jsonb_build_object('status','unknown_revision'); END IF;
  IF action='upsert' THEN
    IF n.state<>'active' THEN RETURN jsonb_build_object('status','trashed'); END IF;
    IF EXISTS(SELECT 1 FROM sync_revisions r,
      LATERAL jsonb_array_elements(COALESCE(r.snapshot->'sourceVersions','[]'::jsonb)) old,
      LATERAL jsonb_array_elements(operation->'snapshot'->'sourceVersions') incoming
      WHERE r.note_id=nid AND old->>'id'=incoming->>'id' AND old<>incoming)
      OR EXISTS(SELECT 1 FROM sync_revisions r,
      LATERAL jsonb_array_elements(COALESCE(r.snapshot->'summaries','[]'::jsonb)) old,
      LATERAL jsonb_array_elements(operation->'snapshot'->'summaries') incoming
      WHERE r.note_id=nid AND old->>'id'=incoming->>'id' AND old<>incoming) THEN
      RETURN jsonb_build_object('status','immutable_version_conflict');
    END IF;
    event_kind:=CASE WHEN expected IS DISTINCT FROM n.head_revision THEN 'conflict' ELSE 'upsert' END;
    INSERT INTO sync_revisions(id,note_id,organization_id,sequence,parent_id,kind,snapshot)
      VALUES(revision,nid,org,seq,expected,event_kind,operation->'snapshot');
    IF event_kind='upsert' THEN UPDATE sync_notes SET head_revision=revision WHERE id=nid RETURNING * INTO n; END IF;
  ELSE
    IF expected IS DISTINCT FROM n.head_revision THEN RETURN jsonb_build_object('status','revision_conflict','headRevision',n.head_revision); END IF;
    IF action='trash' AND n.state='active' THEN
      UPDATE sync_notes SET state='trashed',deletion_id=gen_random_uuid(),deleted_at=clock_timestamp(),
        expires_at=clock_timestamp()+interval '30 days',lifecycle_generation=gen_random_uuid() WHERE id=nid RETURNING * INTO n;
    ELSIF action='restore' AND n.state='trashed' AND n.deletion_id=(operation->>'deletionId')::uuid THEN
      UPDATE sync_notes SET state='active',deletion_id=NULL,deleted_at=NULL,expires_at=NULL,lifecycle_generation=gen_random_uuid() WHERE id=nid RETURNING * INTO n;
    ELSIF action='purge' AND n.state='trashed' AND n.deletion_id=(operation->>'deletionId')::uuid THEN
      UPDATE sync_notes SET state='purged',lifecycle_generation=gen_random_uuid() WHERE id=nid RETURNING * INTO n;
      UPDATE sync_revisions SET snapshot=NULL WHERE note_id=nid;
      DELETE FROM meetings WHERE id=nid AND organization_id=org;
    ELSE RETURN jsonb_build_object('status','lifecycle_conflict'); END IF;
    event_kind:=action;
    INSERT INTO sync_revisions(id,note_id,organization_id,sequence,parent_id,kind) VALUES(revision,nid,org,seq,n.head_revision,event_kind);
  END IF;
  result:=jsonb_build_object('status',CASE WHEN event_kind='conflict' THEN 'conflict' ELSE 'ok' END,
    'noteId',nid,'revision',revision,'headRevision',n.head_revision,'lifecycleGeneration',n.lifecycle_generation,
    'state',n.state,'deletionId',n.deletion_id,'deletedAt',n.deleted_at,'expiresAt',n.expires_at,'sequence',seq::text);
  INSERT INTO sync_operations(id,organization_id,note_id,payload_hash,receipt) VALUES(opid,org,nid,payload_hash,result);
  RETURN result;
END $$;
--> statement-breakpoint
-- Guard older endpoints and web writes even when a previous application version runs.
CREATE FUNCTION sync_guard_legacy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org text; nid uuid; seq bigint; lib uuid;
BEGIN
  IF TG_OP='DELETE' THEN org:=OLD.organization_id; nid:=OLD.id; ELSE org:=NEW.organization_id; nid:=NEW.id; END IF;
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM organization WHERE id=org) THEN RETURN OLD; END IF;
  seq:=sync_next_sequence(org);
  IF TG_OP='UPDATE' AND OLD.organization_id<>NEW.organization_id THEN RAISE EXCEPTION 'sync_owner_immutable'; END IF;
  IF EXISTS(SELECT 1 FROM sync_notes WHERE id=nid) THEN
    IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM sync_notes WHERE id=nid AND organization_id=org AND state='purged') THEN RETURN OLD; END IF;
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
CREATE TRIGGER sync_guard_legacy BEFORE INSERT OR UPDATE OR DELETE ON meetings FOR EACH ROW EXECUTE FUNCTION sync_guard_legacy();
--> statement-breakpoint
-- Atomic full legacy item replacement, suitable for the Neon HTTP one-statement driver.
CREATE FUNCTION sync_legacy_write(org text, item jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE nid uuid:=(item->>'id')::uuid;
BEGIN
  PERFORM sync_next_sequence(org);
  IF EXISTS(SELECT 1 FROM meetings WHERE id=nid AND organization_id<>org) THEN RAISE EXCEPTION 'sync_owner_conflict'; END IF;
  INSERT INTO meetings(id,organization_id,title,kind,status,calendar_event_id,folder_id,started_at,ended_at,created_at,updated_at)
    VALUES(nid,org,item->>'title',item->>'kind','complete',item->>'calendarEventId',
      CASE WHEN EXISTS(SELECT 1 FROM folders WHERE id=(item->>'folderId')::uuid AND organization_id=org) THEN (item->>'folderId')::uuid END,
      (item->>'startedAt')::timestamptz,(item->>'endedAt')::timestamptz,(item->>'createdAt')::timestamptz,clock_timestamp())
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,kind=excluded.kind,calendar_event_id=excluded.calendar_event_id,
      folder_id=excluded.folder_id,started_at=excluded.started_at,ended_at=excluded.ended_at,updated_at=excluded.updated_at
      WHERE meetings.organization_id=org;
  IF NOT FOUND THEN RAISE EXCEPTION 'sync_owner_conflict'; END IF;
  DELETE FROM transcript_segments WHERE meeting_id=nid;
  INSERT INTO transcript_segments(meeting_id,channel,speaker,text,start_ms,end_ms,absolute_start_ms,confidence)
    SELECT nid,s->>'channel',s->>'speaker',s->>'text',(s->>'startMs')::integer,(s->>'endMs')::integer,(s->>'absoluteStartMs')::bigint,(s->>'confidence')::real
    FROM jsonb_array_elements(item->'segments') s;
  INSERT INTO notes(meeting_id,raw_content,enhanced_content,updated_at)
    VALUES(nid,item->'rawContent',item->'enhancedContent',clock_timestamp()) ON CONFLICT(meeting_id)
    DO UPDATE SET raw_content=excluded.raw_content,enhanced_content=excluded.enhanced_content,updated_at=excluded.updated_at;
END $$;
--> statement-breakpoint
CREATE FUNCTION sync_expire(org text, lib uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n sync_notes%ROWTYPE; seq bigint; count integer:=0;
BEGIN
  PERFORM sync_next_sequence(org);
  FOR n IN SELECT * FROM sync_notes WHERE organization_id=org AND library_id=lib AND state='trashed' AND expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 50 FOR UPDATE LOOP
    seq:=sync_next_sequence(org);
    UPDATE sync_notes SET state='purged',lifecycle_generation=gen_random_uuid() WHERE id=n.id;
    UPDATE sync_revisions SET snapshot=NULL WHERE note_id=n.id;
    DELETE FROM meetings WHERE id=n.id AND organization_id=org;
    INSERT INTO sync_revisions(note_id,organization_id,sequence,kind) VALUES(n.id,org,seq,'purge');
    count:=count+1;
  END LOOP;
  RETURN count;
END $$;
--> statement-breakpoint
CREATE FUNCTION sync_guard_legacy_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE nid uuid; org text;
BEGIN
  IF TG_OP='DELETE' THEN nid:=OLD.meeting_id; ELSE nid:=NEW.meeting_id; END IF;
  SELECT organization_id INTO org FROM meetings WHERE id=nid;
  IF TG_OP='DELETE' AND (org IS NULL OR NOT EXISTS(SELECT 1 FROM organization WHERE id=org)) THEN RETURN OLD; END IF;
  IF org IS NOT NULL THEN PERFORM sync_next_sequence(org); END IF;
  IF EXISTS(SELECT 1 FROM sync_notes WHERE id=nid) THEN
    IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM sync_notes WHERE id=nid AND state='purged') THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'sync_upgrade_required';
  END IF;
  IF TG_OP='UPDATE' AND OLD.meeting_id<>NEW.meeting_id THEN RAISE EXCEPTION 'sync_owner_immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
--> statement-breakpoint
CREATE TRIGGER sync_guard_legacy_notes BEFORE INSERT OR UPDATE OR DELETE ON notes FOR EACH ROW EXECUTE FUNCTION sync_guard_legacy_content();
--> statement-breakpoint
CREATE TRIGGER sync_guard_legacy_segments BEFORE INSERT OR UPDATE OR DELETE ON transcript_segments FOR EACH ROW EXECUTE FUNCTION sync_guard_legacy_content();
--> statement-breakpoint
-- Internal billing/account service only; no sync route exposes workspace-wide purge.
CREATE FUNCTION sync_purge_workspace(org text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n sync_notes%ROWTYPE; seq bigint; total integer;
BEGIN
  PERFORM sync_next_sequence(org);
  SELECT count(*) INTO total FROM (SELECT id FROM meetings WHERE organization_id=org UNION SELECT id FROM sync_notes WHERE organization_id=org AND state<>'purged') ids;
  FOR n IN SELECT * FROM sync_notes WHERE organization_id=org AND state<>'purged' FOR UPDATE LOOP
    seq:=sync_next_sequence(org);
    UPDATE sync_notes SET state='purged',lifecycle_generation=gen_random_uuid() WHERE id=n.id;
    UPDATE sync_revisions SET snapshot=NULL WHERE note_id=n.id;
    INSERT INTO sync_revisions(note_id,organization_id,sequence,kind) VALUES(n.id,org,seq,'purge');
  END LOOP;
  DELETE FROM meetings WHERE organization_id=org;
  RETURN total;
END $$;
