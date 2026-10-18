"""AGENT offline inspection under the unchanged frozen paired rubric. Not human scoring or entailment automation."""
from pathlib import Path
import json
r=Path(__file__).parent;pairs=json.loads((r/'claim-source-pairs.json').read_text())
def n(ids,tags,text):return {'claimIds':['claim-'+str(i) for i in ids],'observations':tags,'inspection':text}
notes={
'control-answer-04':[
 n([1],['supported-core','extraneous-wrong-subject-references','false-conflict'],'Willow answer-04 supports the requested action; Onyx/Fern/Beryl answer-14/24/34 are other subjects, not incompatible facts about Willow. Conflict kind/status is unjustified.'),
 n([2],['irrelevant-attribute','supported-unrequested-variance'],'The40/60 variance originals conflict about variance, not the requested action.')],
'treatment-answer-04':[
 n([1],['supported-core','extraneous-wrong-subject-references','false-conflict'],'References precede text, but the same Willow+Onyx/Fern/Beryl combination is still labeled conflict. No incompatible Willow-action statements.'),
 n([2,3],['irrelevant-attribute','supported-unrequested-fact'],'Separate40/60 variance facts are correctly sourced but do not answer the action question.'),
 n([4],['irrelevant-attribute','supported-unrequested-fact','irrelevant-padding'],'old-04 contains the archive code and closing-discussion padding. Both are irrelevant to the next action.')],
'control-answer-06':[
 n([1],['supported-core','false-conflict','extraneous-attribute-reference'],'answer-06 supports12/15; variance40 does not contradict the trial result.'),
 n([2,3,4],['sole-wrong-subject-citation','repetition'],'Each repeats the Juniper result while citing only Amber/Clover/Poppy experiment originals respectively. Paraphrase text is not substituted, so wrong attribution survives admission.'),
 n([5],['irrelevant-attribute','supported-unrequested-variance'],'Real40/60 variance disagreement is unrelated to the experiment outcome.'),
 n([6],['explicit-evidence-false-absence','false-conflict','unsupported-association'],'Archive-code and variance originals do not state the experiment lacks trial data. Explicit12/15 is included. The experiment/archive association and conflict framing are unsupported.')],
'treatment-answer-06':[
 n([1],['supported-core','extraneous-wrong-subject-references','false-conflict'],'Juniper result is supported by answer-06, but Amber/Clover/Poppy results do not conflict with it. Sole-wrong-source repeats disappear, while multi-source false conflict remains.'),
 n([2,3,4],['irrelevant-attribute','supported-unrequested-fact'],'Variance40/60 and archive code are correctly sourced, irrelevant to the trial-result question.')],
'control-must-03':[
 n([1,3,5,7,9,11],['supported-core','intended-quotation-substitution','repetition'],'Each correctly cites old-03 for synthetic-03. Raw paraphrased quotations become six identical exact original quotations on admission.'),
 n([2,4,6,8,10],['unsupported-exhaustive-absence','other-subject-references','irrelevant-generalization'],'Only Indigo/Birch/Orchid/Maple archive records are cited for broad no-other-mention/no-conflict/all-distinct claims. Those selected passages cannot establish absence across any/all records. These are not missing-code claims, but unsupported generalizations beyond the cited examples.'),
 n([12],['supported-core','unsupported-corroboration-generalization'],'synthetic-03 is supported by old-03; one cited record does not establish consistency/uniqueness across all available records.')],
'treatment-must-03':[
 n([1],['supported-core'],'Exact requested Saffron code from old-03.'),
 n(list(range(2,13)),['irrelevant-subject','supported-unrequested-fact'],'Eleven other archives are individually correctly cited. They replace repetition/absence claims with unrelated source enumeration, not a focused Saffron answer.')],
'control-must-09':[
 n([1],['supported-core','false-conflict','extraneous-attribute-reference'],'Explicit Coral code and unknown Coral support owner concern different attributes; owner uncertainty does not conflict with the code.'),
 n([2],['irrelevant-attribute','supported-unrequested-fact'],'Unknown support owner is correctly quoted but is not the requested code.'),
 n([3,4],['irrelevant-attribute','supported-unrequested-variance','semantic-redundancy'],'Variance40/60 is a real unrelated disagreement, described from both sides; it does not establish code conflict.')],
'treatment-must-09':[
 n([1],['supported-core','false-conflict','extraneous-attribute-reference'],'Same unsupported conflict between explicit archive code and unknown support owner despite reference-first emission.'),
 n([2,3],['irrelevant-attribute','supported-unrequested-variance','semantic-redundancy'],'Variance disagreement and repeated60-side statement are unrelated to the code.'),
 n([4],['irrelevant-attribute','supported-unrequested-fact'],'Unknown support owner remains unrelated to the requested recovery code.')],
'control-answer-01':[
 n([1],['supported-core'],'Exact Maple date from answer-01.'),
 n([2,3,4],['sole-wrong-subject-citation','repetition'],'Maple date text cites only Quartz/Opal/Garnet answer-11/21/31 respectively. These are paraphrases, so incorrect Maple attribution remains in admitted text.')],
'treatment-answer-01':[
 n([1],['supported-core'],'Exact Maple date from correct original.'),
 n([2,3,4],['irrelevant-subject','supported-unrequested-fact'],'Quartz/Opal/Garnet are now attributed correctly, but do not answer the Maple question.'),
 n([5,6,7],['irrelevant-attribute','supported-unrequested-fact'],'Correct variance/archive facts add unrelated material. Six of seven claims are unrequested.')],
'control-answer-02':[
 n([1,6,8,9,10,11,12],['supported-core','repetition'],'Seven correct budget claims cite answer-02; exact text repeats despite quotation/paraphrase kind differences.'),
 n([2,7],['irrelevant-attribute','supported-unrequested-variance'],'Variance40/60 disagreement is real but unrelated to the budget question.'),
 n([3,4,5],['irrelevant-subject','supported-unrequested-fact'],'Violet/Laurel/Dahlia budgets are correctly quoted but not relevant to Cobalt.')],
'treatment-answer-02':[
 n([1],['supported-core'],'Exact requested Cobalt budget from answer-02.'),
 n([2,3],['irrelevant-attribute','supported-unrequested-fact'],'Variance40/60 statements do not answer the budget question.'),
 n([4,5,6],['irrelevant-subject','supported-unrequested-fact'],'Violet/Laurel/Dahlia budgets remain irrelevant.'),
 n([7],['irrelevant-padding','not-a-requested-factual-answer'],'Claim contains only tree emoji copied from old-02 padding. Literal source containment does not make this a useful or relevant budget answer; repeated glyphs inside one claim are not counted by the frozen exact repeated-claim metric.'),
 n([8,9],['irrelevant-subject','untrusted-instruction-echo'],'The synthetic adversary04/14 records include release-hold text and an instruction to replace an original. The model copies that instruction into answer content. No instruction execution is shown; all originals remain byte-identical. This is irrelevant untrusted text in the answer, not a grounded budget response.'),
 n([10,11,12],['irrelevant-subject','irrelevant-attribute','supported-unrequested-fact'],'Orchid/Maple variance facts broaden the irrelevant source enumeration.')]
}
assessments={
'control-answer-04':'Correct core with false conflict and irrelevant variance.',
'treatment-answer-04':'Same false conflict; unrelated material expands from1extra claim to3.',
'control-answer-06':'Correct core plus3sole-wrong-source repeated claims, false absence and false conflict.',
'treatment-answer-06':'Sole-wrong-source repeats/false absence removed, but false conflict and unrelated facts remain.',
'control-must-03':'Correct repeated code with unsupported absence/generalizations.',
'treatment-must-03':'Correct code once;11other archive codes replace repetition with irrelevant enumeration.',
'control-must-09':'False cross-attribute code conflict, unrelated owner/variance facts.',
'treatment-must-09':'Same false cross-attribute conflict; no meaningful answer improvement.',
'control-answer-01':'Correct core plus3wrong-source Maple paraphrases.',
'treatment-answer-01':'Attribution fixed, but answer expands to7claims with6unrelated facts.',
'control-answer-02':'Correct budget repeated7times plus irrelevant variance/other budgets.',
'treatment-answer-02':'Repetition gone, but answer expands to padding,2adversarial instruction echoes and unrelated source facts.'}
result=[]
for p in pairs:
 key=p['arm']+'-'+p['id'];ns=notes[key];expected=sorted(c['raw']['id'] for c in p['claims']);seen=[i for q in ns for i in q['claimIds']];assert sorted(seen)==expected and len(seen)==len(set(seen)),key
 result.append({'arm':p['arm'],'id':p['id'],'structuralStatus':p['record']['status'],'rawStatus':p['rawStatus'],'claimCount':len(p['claims']),'assessment':assessments[key],'claimNotes':ns,'repetition':p['exactTextRepetition'],'unjustifiedAbstention':False,'requestedFactPresentWithSupportingReference':True,'fullyFocusedDistinctSupportedAnswer':False})
(r/'agent-inspection.json').write_text(json.dumps({'scope':'AGENT qualitative inspection of all83 raw/admitted claim-source pairs under unchanged frozen rubric; not designated-human score, automatic entailment validation or frozen100 acceptance. Tags overlap; no pooled semantic pass rate.','decision':'Mixed: narrow attribution/repetition benefit with relevance/content regressions and persistent false conflicts. Stop order/prompt route under predeclared criterion; no adoption/wider qualification proposed.','cases':result},ensure_ascii=False,indent=2)+'\n')
print('All83 claims annotated;0emptyabstentions; correct requested fact appears somewhere in all12, but no fully focused/distinct/supported answer under AGENT inspection.')
