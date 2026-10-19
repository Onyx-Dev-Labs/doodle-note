"""AGENT-authored offline inspection under pre-frozen RUBRIC.md. Not an entailment oracle or human score."""
import json
from pathlib import Path
r=Path(__file__).parent
pairs=json.loads((r/'claim-source-pairs.json').read_text())
def note(ids,tags,text):return {'claimIds':['claim-'+str(i) for i in ids],'observations':tags,'inspection':text}
notes={
'control-answer-04':[
 note([1],['supported-core','extraneous-wrong-subject-references','false-conflict'], 'Willow answer-04 supports the action. Onyx/Fern/Beryl answer-14/24/34 actions are different subjects, not incompatible Willow facts. Conflict kind/status is unjustified.'),
 note([2],['irrelevant-attribute'], 'The 40/60 variance originals do conflict about variance, but that is not the requested next action. Do not count a real variance disagreement as proof of an action conflict.'),
 note([3],['irrelevant-attribute','supported-unrequested-fact'], 'old-04 contains the archive code. It does not answer the next-action question.')],
'control-answer-06':[
 note([1],['supported-core','false-conflict','extraneous-attribute-reference'], 'answer-06 explicitly supports 12/15. The variance40 original does not contradict that result.'),
 note([2],['false-conflict','contradicts-explicit-evidence','unsupported-cross-attribute-attribution'], 'Claim denies the explicit 12/15 result while citing only variance40/60 originals; neither supports the experiment denial.'),
 note([3,5,9],['irrelevant-attribute','unsupported-association'], 'old-06 is an archive-code record, not a statement about the experiment or its relationship to that code. Claims transfer archive context to the experiment.'),
 note([4,6,8,11],['explicit-evidence-false-absence'], 'Claims say the experiment/rate is unspecified, undescribed, unclear or not tied to a rate. Included answer-06 explicitly states 12/15. Their variance/archive references do not establish absence.'),
 note([7,10,12],['false-conflict','explicit-evidence-false-absence','extraneous-attribute-reference'], 'Citations combine explicit 12/15 with variance60 and claim lack of consensus/confirmation/outcome. Different attributes do not create a conflict about trial results.')],
'control-must-03':[
 note([1,5,7,9,11],['supported-core','intended-quotation-substitution'], 'Each cites old-03 and asserts synthetic-03. Raw paraphrased quotation text becomes the exact original on admission; this produces five admitted copies.'),
 note([2],['supported-core'], 'old-03 directly supports the recovery code and personal-record provenance.'),
 note([3,4,6,8,10,12],['unsupported-exhaustive-absence','other-subject-references','irrelevant-generalization'], 'Only Indigo/Birch/Orchid/Maple archive records are cited for broad no-other-mention/no-contradiction claims about Saffron. These selected passages cannot establish dataset-wide absence; prompt inclusion is nonexhaustive. Claims3/8/12 also use conflict kind while saying no contradiction, not describing incompatible facts.')],
'control-must-09':[],
'control-answer-01':[
 note([1],['supported-core'], 'Exact Maple date from answer-01.'),
 note([2,3,4],['raw-wrong-subject-citation','intended-quotation-substitution','admitted-irrelevant-subject'], 'Raw text says Maple but sole references are Quartz/Opal/Garnet answer-11/21/31. Admission replaces the text with each correct cited original, so displayed claims name those other projects rather than falsely quoting Maple. They remain irrelevant to the Maple question.')],
'control-answer-02':[
 note([1,6,9,10,11,12],['supported-core','repetition'], 'Six exact budget quotations cite answer-02 correctly; repetitions do not add answer value.'),
 note([2,7,8],['irrelevant-attribute','supported-unrequested-variance'], 'Variance40/60 originals establish a variance disagreement, not a conflict about the4200 budget. Claims2/7 repeat the same text.'),
 note([3,4,5],['irrelevant-subject','supported-unrequested-fact'], 'Violet/Laurel/Dahlia budget facts are correctly cited but do not answer the Cobalt question.')],
 'treatment-answer-04':[
 note([1],['supported-core','intended-quotation-substitution'], 'Correct Willow source; admitted quotation includes its subject.'),
 note([2,3,4],['irrelevant-subject','intended-quotation-substitution'], 'Raw bare Morgan/checklist text does not explicitly name Willow, but these references are Onyx/Fern/Beryl. Admission reveals those exact subjects. Correct source text does not make them relevant to Willow.'),
 note([5],['supported-core','semantic-redundancy'], 'Correct Willow paraphrase repeats claim1 factual content.'),
 note([6],['irrelevant-attribute','supported-unrequested-variance'], 'Real variance40/60 disagreement is unrelated to next action. Answered status with conflict kind is structurally permitted.'),
 note([7],['explicit-evidence-false-absence','unsupported-cross-attribute-attribution'], 'Says Willow action is not specified, citing only archive code old-04 despite explicit included answer-04.')],
 'treatment-answer-06':[],
 'treatment-must-03':[
 note([1,4],['supported-core','intended-quotation-substitution','repetition'], 'Both correctly cite old-03 and become two copies of its exact quotation.'),
 note([2,3,5,6,7,8,9,10,11,12],['supported-core','repetition'], 'All cite old-03 for synthetic-03. Wording varies slightly in3/5; claims2/6/7/8/9/10/11/12 have identical raw/admitted text. Prior broad absence claims are gone, but redundancy remains severe.')],
 'treatment-must-09':[],
 'treatment-answer-01':[
 note([1,2],['supported-core','semantic-redundancy'], 'Both cite the actual Maple date. Claim2 metadata wording adds no needed fact.'),
 note([3,4,5],['irrelevant-subject','supported-unrequested-fact'], 'Quartz/Opal/Garnet are now quoted with their own names, but are still irrelevant to Maple.'),
 note([6,12],['extraneous-wrong-subject-references','unsupported-corroboration-generalization'], 'One Maple original plus Quartz/Opal/Garnet does not establish that multiple entries/all evidence report Maple or merely vary its product type. The date itself is supported by answer-01; the asserted corroboration is not.'),
 note([7,8,10],['irrelevant-attribute','supported-unrequested-fact'], 'Exact variance/archive quotations do not answer the delivery-date question.'),
 note([9,11],['irrelevant-attribute','unsupported-independence-generalization'], 'Variance/code originals do not state that delivery is unaffected by, or unrelated to, those attributes. No such causal/independence inference is supported.')],
 'treatment-answer-02':[
 note([1,8,9,10,11,12],['supported-core','repetition'], 'Six exact budget quotations correctly cite answer-02.'),
 note([2,3],['irrelevant-attribute','supported-unrequested-fact'], 'Variance40 and60 are correctly cited as separate facts, but unrelated to the requested budget.'),
 note([4,5,6],['irrelevant-subject','supported-unrequested-fact'], 'Violet/Laurel/Dahlia budgets remain unrelated to Cobalt.'),
 note([7],['false-conflict','unsupported-cross-attribute-attribution'], 'Repeats the4200 Cobalt budget as conflict while citing ONLY variance40/60. Those originals neither support4200 nor conflict about the asked budget. The answer-02 source is available but is not cited by this claim.')]
}
caseNotes={
 'control-answer-04':'Requested action appears, but false conflict and unrelated material make the answer unfocused.',
 'control-answer-06':'Requested12/15 appears but is contradicted by generated denial/absence/conflict claims. Not a reliable answer.',
 'control-must-03':'Correct code plus unsupported dataset-wide absence and repetition. Not a focused answer.',
 'control-must-09':'Unjustified insufficient-evidence abstention: explicit synthetic-09 is first in actual included evidence.',
 'control-answer-01':'Correct Maple date plus three unrelated admitted quotations. Raw wrong-attribution labels are corrected by intended quotation substitution, not by the model.',
 'control-answer-02':'Correct budget plus irrelevant facts and repetition. No focused answer.',
 'treatment-answer-04':'False conflict status removed, but a new explicit false-absence claim and irrelevant/redundant claims remain.',
 'treatment-answer-06':'Unjustified insufficient-evidence abstention despite explicit12/15: desired answer is lost versus CONTROL. Not a successful alternative to hallucinated conflicts.',
 'treatment-must-03':'All claims are grounded in correct original and requested code; broad absence removed.12claims and eight identical paraphrases still violate the focused/fewest-distinct objective. Narrow grounding improvement only.',
 'treatment-must-09':'Same unjustified abstention as CONTROL despite code on wire; no improvement.',
 'treatment-answer-01':'Raw quotation attribution improves, but admitted irrelevant facts increase and unsupported cross-project corroboration/independence claims appear.',
 'treatment-answer-02':'Correct core remains, but irrelevant material/repetition persist and claim7 newly misattributes budget to variance evidence.'
}
result=[]
for p in pairs:
 key=p['arm']+'-'+p['id'];ns=notes[key];expected=sorted(c['raw']['id'] for c in p['claims']);seen=[i for n in ns for i in n['claimIds']]
 assert sorted(seen)==expected and len(seen)==len(set(seen)),key
 result.append({'arm':p['arm'],'id':p['id'],'structuralStatus':p['record']['status'],'rawStatus':p['rawStatus'],'claimCount':len(p['claims']),'assessment':caseNotes[key],'claimNotes':ns,'repetition':p['exactTextRepetition'],'unjustifiedAbstention':key in ['control-must-09','treatment-answer-06','treatment-must-09'],'fullyFocusedDistinctSupportedAnswer':False})
(r/'agent-inspection.json').write_text(json.dumps({'scope':'AGENT qualitative inspection of all86 raw/admitted claims under frozen rubric; not designated-human scoring, automatic entailment validation, or frozen100 acceptance. Tags overlap and are observations, not a semantic pass rate.','cases':result},ensure_ascii=False,indent=2)+'\n')
print('Annotated all',sum(len(x['claims']) for x in pairs),'claims across',len(result),'cases;3 explicit-gold abstentions. No designated-human scores.')
