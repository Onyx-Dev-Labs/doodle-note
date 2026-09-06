"""Disposable local PostgreSQL concurrency and migration rollback check. No DATABASE_URL use."""
import concurrent.futures
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(os.environ.get('POSTGRES_BIN', '/opt/homebrew/bin'))


def uid():
    return str(uuid.uuid4())


def operation(library, note):
    source = uid()
    snapshot = dict(title='synthetic', kind='note', createdAt='2026-09-06', language='en-US', text='synthetic',
                    passages=[], speakers=[], sourceRevisionId=source, selectedSummaryId=None,
                    sourceVersions=[dict(id=source, title='synthetic', text='synthetic', passages=[], speakers=[])],
                    summaries=[], inkAttachments=[])
    return dict(protocolVersion=2, libraryId=library, noteId=note, operationId=uid(), kind='upsert',
                expectedRevision=None, expectedLifecycleGeneration=None, snapshot=snapshot)


def main():
    for binary in ('initdb', 'pg_ctl', 'psql'):
        if not (BIN / binary).exists():
            raise SystemExit('Set POSTGRES_BIN to a local PostgreSQL installation; no server was contacted.')
    with tempfile.TemporaryDirectory(prefix='dnpg-', dir='/tmp') as temporary:
        data = str(Path(temporary) / 'data')
        subprocess.run([str(BIN/'initdb'), '-D', data, '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([str(BIN/'pg_ctl'), '-D', data, '-l', str(Path(temporary)/'server.log'), '-o',
                        f"-k {temporary} -p 55458 -c listen_addresses=''", '-w', 'start'], check=True, capture_output=True)
        def sql(query):
            return subprocess.run([str(BIN/'psql'), '-h', temporary, '-p', '55458', '-d', 'postgres',
                                   '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', query],
                                  check=True, capture_output=True, text=True).stdout.strip()
        def apply(org, op):
            payload = json.dumps(op).replace("'", "''")
            return json.loads(sql(f"SELECT sync_apply('{org}','{payload}'::jsonb,'synthetic-{op['operationId']}');"))
        try:
            journal=json.loads((ROOT/'drizzle/meta/_journal.json').read_text())['entries']
            for entry in journal:
                migration=(ROOT/'drizzle'/f"{entry['tag']}.sql").read_text()
                if entry['idx']==13:
                    sql('BEGIN;'+migration+'ROLLBACK;')
                    assert sql("SELECT to_regclass('sync_notes') IS NULL;")=='t'
                    sql('BEGIN;'+migration+'COMMIT;')
                else:
                    sql(migration)
            sql("INSERT INTO organization(id,name,slug,created_at) VALUES('a','A','a',now()),('b','B','b',now());")
            lib=uid()
            with concurrent.futures.ThreadPoolExecutor(2) as pool:
                outcomes=list(pool.map(lambda args:apply(*args), [('a',operation(lib,uid())),('b',operation(lib,uid()))]))
            assert sorted(r['status'] for r in outcomes)==['not_found','ok'], outcomes
            assert sql('SELECT count(*) FROM sync_notes n JOIN sync_libraries l ON n.library_id=l.id WHERE n.organization_id<>l.organization_id;')=='0'
            lib,note=uid(),uid()
            first=apply('a',operation(lib,note))
            edits=[operation(lib,note),operation(lib,note)]
            for op in edits:
                op.update(expectedRevision=first['headRevision'], expectedLifecycleGeneration=first['lifecycleGeneration'])
            with concurrent.futures.ThreadPoolExecutor(2) as pool:
                outcomes=list(pool.map(lambda op:apply('a',op),edits))
            assert sorted(r['status'] for r in outcomes)==['conflict','ok'], outcomes
            assert sql(f"SELECT count(*) FROM sync_revisions WHERE note_id='{note}';")=='3'
            print('PASS: migration rollback/reapply, cross-workspace library race, concurrent same-base edits preserve conflict')
        finally:
            subprocess.run([str(BIN/'pg_ctl'), '-D', data, '-m', 'fast', '-w', 'stop'], check=True, capture_output=True)


if __name__=='__main__':
    main()
