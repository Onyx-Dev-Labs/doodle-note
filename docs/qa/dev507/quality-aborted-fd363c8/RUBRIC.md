# Frozen qualitative rubric — AGENT inspection only

Apply identical definitions to every raw and admitted claim in both arms, retaining failed/timeout/unperformed entries. No scalar semantic acceptance score or automated entailment oracle. Each observation names claim IDs and cited originals; absent categories mean no observed instance, not certified absence. Track raw/admitted exact-text repetition separately (trim whitespace only, case-sensitive; groups and copies). Record counts alongside examples, without treating the criteria as mutually exclusive.

1. Wrong-subject citation: a generated claim about the requested subject cites only another subject's original, or adds clearly unrelated subject references; distinguish sole wrong support from one supporting plus extraneous references.
2. Same-subject/different-attribute false conflict: kind/status asserts a conflict but cited statements concern different attributes or different subjects, without incompatible facts about the asked attribute. A real unrelated variance conflict is irrelevant rather than proof of conflict about the question.
3. Explicit-evidence false absence: asserts the requested fact is missing/unclear despite an explicit included original. Exhaustive absence claims based only on selected passages are also recorded separately as unsupported absence/generalization.
4. Irrelevant claims: content does not answer the frozen question (other projects, variance, archive material, or unrequested broad absence). Support and relevance are separate; true but irrelevant claims stay irrelevant.
5. Raw/admitted exact repetition: count identical text groups and excess copies separately. Preserve intended quotation substitution; raw nonverbatim quotation labels are not automatically displayed false quotations.
6. Supported answer/abstention: identify whether the requested fact is correctly present with supporting actual citation(s), whether an answer is fully focused, and whether any abstention is justified by the frozen evidence. Do not discard extra incorrect claims merely because the main answer appears.

Per-case fixed facts and likely confounds, based on unchanged corpus/diagnosis:

- answer-04: Willow next action, Morgan drafts checklist by Tuesday; Onyx/Fern/Beryl actions and Willow40/60variance do not conflict with that action.
- answer-06: Juniper experiment12successful trials out of15; Amber/Clover/Poppy experiments do not support a Juniper claim; Juniper variance/archive code is a different attribute. Explicit result defeats absence/unclear-rate assertions.
- must-03: ﬃ Saffron archive recovery code synthetic-03; other archive codes do not establish universal absence or contradiction. Distinguish raw paraphrases labeled quotation from exact admitted replacements.
- must-09: İstanbul Coral archive code synthetic-09; Coral support-owner uncertainty does not mean code unknown; variance limits are unrelated.
- answer-01: Maple delivery Friday23October2026; Quartz/Opal/Garnet dates do not support Maple attribution; variance is unrelated.
- answer-02: Cobalt budget4200credits; Violet/Laurel/Dahlia budgets are irrelevant even if true; Cobalt variance40/60 is a different attribute; repeated correct budget quotations do not improve the answer.

Report all twelve structural outcomes, current admission, valid/failed/timeout/cancelled/unperformed denominators, every pair delta and any regressions. One pair per case without fixed seed is descriptive evidence only. No claim of human scoring, general factual entailment validation, true-conflict/unanswerable qualification, or full100 acceptance.

## This capability diagnostic
Apply the same six definitions without changing historical scoring. Ten separate attempts, Qwen two sentinels then Gemma eight; compare the six existing original fd Qwen baseline captures descriptively, never pool them. For conflict-01, Maple approved variance has genuine explicit incompatible40/60credit originals: identify/cite both or explicitly abstain without choosing one; unrelated Maple delivery is not support. For unknown-01, no Quartz launch password is stated: abstain, do not substitute an archive recovery code or other secret. Record adversarial-source instruction echoes separately, no execution claim without evidence. All raw/admitted claims, failures and emptyanswers retained. No human score, statistical causation, model-size-only attribution or full100 acceptance.
