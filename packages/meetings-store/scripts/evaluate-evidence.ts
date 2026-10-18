/** Frozen synthetic retrieval only. No model/tokenizer, network or application profile. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { retrieveOriginalEvidence } from '../src/evidence-retrieval';
import { localSourceScope, resolveOriginalSource } from '../src/source-projection';

const corpusPath = fileURLToPath(new URL('../../../docs/qa/dev507/quality-corpus-v1.json', import.meta.url));
const bytes = readFileSync(corpusPath);
const hash = createHash('sha256').update(bytes).digest('hex');
assert.equal(hash, readFileSync(corpusPath.replace('.json', '.sha256'), 'utf8').split(' ')[0]);
const corpus = JSON.parse(bytes.toString());
const root = mkdtempSync(join(tmpdir(), 'dev507-quality-'));
try {
  const originals = new Map<string, string>();
  const put = (record: { id: string }) => {
    const raw = JSON.stringify(record); originals.set(record.id, raw);
    writeFileSync(join(root, record.id + '.json'), raw);
  };
  for (const doc of corpus.documents) put(doc);
  for (let i = 0; i < corpus.filler.count; i++) {
    const {count: _, idPrefix, ...fields} = corpus.filler;
    put({id: idPrefix + String(i).padStart(4, '0'), ...fields});
  }
  const context = {meetingsDir: root, scope: localSourceScope(root, true), authorized: true};
  const cases = corpus.cases.map((c: {
    id: string; category: string; retrievalSet?: string; question: string;
    gold: Array<{meetingId: string; kind: string; startUtf16: number; endUtf16: number; quote: string}>;
  }) => {
    const bundle = retrieveOriginalEvidence(context, {mode: 'question', question: c.question, filters: {}});
    assert.equal(bundle.coverage.scanComplete, true, c.id);
    for (const range of bundle.ranges) {
      const resolved = resolveOriginalSource(context, range.anchor);
      assert.equal(resolved.status, 'resolved');
      if (resolved.status === 'resolved') assert.equal(resolved.passage.text.slice(range.startUtf16, range.endUtf16), range.quote);
      assert.ok(['personal','transcript'].includes(range.anchor.kind));
    }
    const goldHits = c.gold.map(g => {
      // Corpus gold is in whole raw Markdown/segment coordinates. Canonical v1
      // personal sources are lines. Translate coordinates without changing gold.
      const raw = JSON.parse(originals.get(g.meetingId)!);
      let start = g.startUtf16, end = g.endUtf16, sourceId = 'transcript:original-segment';
      const text = g.kind === 'personal' ? raw.rawNotesMarkdown : raw.segments[0].text;
      assert.equal(text.slice(start, end), g.quote, c.id + ' frozen raw gold');
      if (g.kind === 'personal') {
        const prefix = text.slice(0, start); const line = prefix.split('\n').length - 1;
        const lineStart = prefix.lastIndexOf('\n') + 1;
        start -= lineStart; end -= lineStart; sourceId = 'personal:' + line;
      }
      return bundle.ranges.some(r => r.anchor.meetingId === g.meetingId && r.anchor.kind === g.kind && r.anchor.sourceId === sourceId && r.startUtf16 <= start && r.endUtf16 >= end && r.quote.includes(g.quote));
    });
    return {id:c.id, category:c.category, retrievalSet:c.retrievalSet, goldHits, allGoldSelected:goldHits.every(Boolean), selected:bundle.ranges.length, scanComplete:bundle.coverage.scanComplete, selectionComplete:bundle.coverage.selectionComplete, omissions:bundle.coverage.omissions, selectedRanges:bundle.ranges.map(r=>({meetingId:r.anchor.meetingId,kind:r.anchor.kind,startUtf16:r.startUtf16,endUtf16:r.endUtf16}))};
  });
  for (const [id, raw] of originals) assert.equal(readFileSync(join(root,id+'.json'),'utf8'), raw);
  const score = (set: string) => {
    const group = cases.filter((c: {retrievalSet?:string}) => c.retrievalSet === set);
    const hits = group.filter((c: {allGoldSelected:boolean}) => c.allGoldSelected).length;
    return {hits, total:group.length, recall:hits/group.length};
  };
  console.log(JSON.stringify({
    kind:'synthetic-retrieval-only', corpusSha256:hash,
    implementationSha:execFileSync('/Library/Developer/CommandLineTools/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    node:process.version, measuredAt:new Date().toISOString(), originalCount:originals.size,
    must20:score('must20'), lexical40:score('lexical40'), originalsUnchanged:true,
    actualNativeWire:'NOT MEASURED BY THIS RETRIEVAL-ONLY EVALUATOR: see separate native run', humanSemanticScoring:'NOT RUN: designated independent reviewer required',
    productionGate:'off', cases
  }, null, 2));
} finally { rmSync(root, {recursive:true, force:true}); }
