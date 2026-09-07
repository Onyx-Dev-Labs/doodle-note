-- Server-side selection copies immutable JSON verbatim, including future fields.
CREATE FUNCTION sync_choose_revision(org text, operation jsonb, operation_hash text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  n sync_notes;
  previous sync_operations;
  selected sync_revisions;
  revision uuid := gen_random_uuid();
  sequence bigint;
  receipt jsonb;
BEGIN
  sequence := sync_next_sequence(org);
  SELECT * INTO n FROM sync_notes
    WHERE id=(operation->>'noteId')::uuid AND library_id=(operation->>'libraryId')::uuid
      AND organization_id=org FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF n.state='purged' THEN RETURN jsonb_build_object('status','purged'); END IF;
  SELECT * INTO previous FROM sync_operations WHERE id=(operation->>'operationId')::uuid;
  IF FOUND THEN
    IF previous.organization_id<>org OR previous.note_id<>n.id OR previous.payload_hash<>operation_hash THEN
      RETURN jsonb_build_object('status','operation_reused');
    END IF;
    RETURN previous.receipt;
  END IF;
  IF n.state<>'active' OR n.lifecycle_generation<>(operation->>'expectedLifecycleGeneration')::uuid
    OR n.head_revision IS DISTINCT FROM (operation->>'expectedRevision')::uuid THEN
    RETURN jsonb_build_object('status','changed');
  END IF;
  SELECT * INTO selected FROM sync_revisions WHERE id=(operation->>'selectedRevision')::uuid
    AND organization_id=org AND note_id=n.id AND snapshot IS NOT NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
  -- Legacy revisions are preserved in history but cannot masquerade as a native snapshot.
  IF selected.kind='legacy' THEN RETURN jsonb_build_object('status','unsupported_version'); END IF;
  INSERT INTO sync_revisions(id,note_id,organization_id,sequence,parent_id,kind,snapshot)
    VALUES(revision,n.id,org,sequence,n.head_revision,'reconcile',selected.snapshot);
  UPDATE sync_notes SET head_revision=revision WHERE id=n.id;
  receipt := jsonb_build_object('status','ok','revision',revision,'headRevision',revision,
    'lifecycleGeneration',n.lifecycle_generation,'state',n.state);
  INSERT INTO sync_operations(id,organization_id,note_id,payload_hash,receipt)
    VALUES((operation->>'operationId')::uuid,org,n.id,operation_hash,receipt);
  RETURN receipt;
END $$;
--> statement-breakpoint
-- Lifecycle events have no snapshot. Follow their actual parent, not the newest
-- conflict, to find the note's selected content after Trash/restore.
CREATE FUNCTION sync_reader_head(nid uuid) RETURNS TABLE(id uuid, snapshot jsonb)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE chain AS (
    SELECT r.id,r.parent_id,r.snapshot,ARRAY[r.id] AS visited
      FROM sync_notes n JOIN sync_revisions r ON r.id=n.head_revision
      WHERE n.id=nid AND r.note_id=nid
    UNION ALL
    SELECT p.id,p.parent_id,p.snapshot,c.visited||p.id
      FROM chain c JOIN sync_revisions p ON p.id=c.parent_id
      WHERE c.snapshot IS NULL AND p.note_id=nid AND NOT p.id=ANY(c.visited)
  ) SELECT chain.id,chain.snapshot FROM chain WHERE chain.snapshot IS NOT NULL LIMIT 1;
$$;
