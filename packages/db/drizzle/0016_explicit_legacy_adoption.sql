-- Explicit account-scoped adoption. No scheduled/backfill invocation is included.
CREATE FUNCTION sync_adopt_legacy(org text, operation jsonb, payload_hash text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  lib uuid := (operation->>'libraryId')::uuid;
  nid uuid := (operation->>'noteId')::uuid;
  opid uuid := (operation->>'operationId')::uuid;
  n sync_notes%ROWTYPE;
  previous sync_operations%ROWTYPE;
  revision uuid := gen_random_uuid();
  seq bigint;
  legacy jsonb;
  result jsonb;
BEGIN
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
  SELECT * INTO n FROM sync_notes WHERE id=nid;
  IF FOUND THEN
    -- Repeated adoption never overwrites an enriched head, restores Trash, or revives purge.
    RETURN jsonb_build_object('status',CASE WHEN n.state='purged' THEN 'purged' ELSE 'already_adopted' END,
      'noteId',nid,'libraryId',n.library_id);
  END IF;
  SELECT jsonb_build_object('legacyMeeting',to_jsonb(m),'legacyNotes',
    (SELECT to_jsonb(nt) FROM notes nt WHERE nt.meeting_id=m.id),'legacySegments',
    COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY start_ms,id) FROM transcript_segments t WHERE meeting_id=m.id),'[]'::jsonb))
    INTO legacy FROM meetings m WHERE id=nid AND organization_id=org FOR UPDATE;
  IF legacy IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
  INSERT INTO sync_libraries(id,organization_id) VALUES(lib,org) ON CONFLICT DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM sync_libraries WHERE id=lib AND organization_id=org) THEN
    RETURN jsonb_build_object('status','not_found');
  END IF;
  INSERT INTO sync_notes(id,library_id,organization_id) VALUES(nid,lib,org) RETURNING * INTO n;
  INSERT INTO sync_revisions(id,note_id,organization_id,sequence,kind,snapshot)
    VALUES(revision,nid,org,seq,'legacy',legacy);
  UPDATE sync_notes SET head_revision=revision WHERE id=nid;
  result := jsonb_build_object('status','ok','noteId',nid,'libraryId',lib,'revision',revision,
    'headRevision',revision,'lifecycleGeneration',n.lifecycle_generation,'state','active');
  INSERT INTO sync_operations(id,note_id,organization_id,payload_hash,receipt)
    VALUES(opid,nid,org,payload_hash,result);
  RETURN result;
EXCEPTION WHEN unique_violation THEN
  -- A reused operation identity from another workspace rolls back this entire adoption.
  RETURN jsonb_build_object('status','operation_reused');
END $$;
