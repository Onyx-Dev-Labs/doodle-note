# Frozen paired relevance diagnostic

Production fd363c81d5b7d8f2845ca85b3342cd1c7a6119e8; evidence HEAD ffa54854564ab9ad1b1fc21e844c4a18c92b7b15. No checkout edits. One external treatment overlay only.

First six CONTROL calls, then six TREATMENT calls; order in each: answer-04, answer-06, must-03, must-09, answer-01, answer-02. Exactly one new sampling attempt per entry; no retry/best-of/output repair. Previous six and native79 remain immutable and excluded from these twelve outcomes. No frozen100 acceptance.

Single treatment sentence inserted immediately after the existing fewest-distinct-supported-claims sentence:

Only treat evidence as conflicting when it makes incompatible statements about the same subject and the same attribute asked about.

No other prompt, schema, retrieval, temperature, source, parser or output-setting change. Exact treatment.diff and per-source arm hashes are frozen. No fixed seed is added: one stochastic sample per case/arm and ordered arms cannot establish causality or generalize to conflicts/unanswerable/Brief workloads.

All six cases in both arms must pass actual-model-tokenizer preflight before sampling any case. Actual MainCitedAskService retrieves and resolves originals; its preflight generate dependency captures its exact selected input and builds the actual arm's production prompt with the real loaded model/context/session tokenizer. It then throws a designated QA-preflight sentinel, so the service drains without creating any generated snapshot. This is preparation, not a fabricated answer or sampling attempt. Native promptWithMeta is never invoked in preflight. Compare selected inputs, final ranges/IDs/quotes/order/UTF16 offsets/parent IDs, omitted IDs, completeness, serialized user data and schema against the prior six and both arms. Control system/wire must equal prior bytes. Treatment system must equal the one-sentence edit; no post-budget system interception. Abort whole experiment on mismatch or budget failure, retaining all12 as unperformed. Preflight native preparation/tokenization/grammar compilation is part of this bounded workload.

Use exact approved readonly Qwen model, Metal prebuilt build:never, context16384, temperature0.3, output4096, safety256. Copies of the prior canonical identity and all701 originals are identical in both fresh arm directories; no old-root writes. One arm's model is disposed before the next, including between preflight and sampling. Observer forwards exact native options/result and records same-runtime grammar identity, schema/GBNF/wire hashes, responseText/stopReason/token-meter deltas/rawJson, policy2/admission and context/model/service cleanup. Timings include observer overhead and are diagnostic only.

180-second AbortSignal per preparation/sampling case with awaited service/context cleanup;40-minute outer watchdog for the experiment. First timeout/cancellation/drain/containment/integrity failure or two consecutive identical runtime/grammar/protocol failures stops sampling; all remaining entries retain unperformed status. Ordinary semantic failures remain outcomes. One handled graceful owned signal before last-resort group kill; never signal unrelated processes. No native work beyond twelve samples or stop condition.

Freeze this plan, rubric, initial12ledger, observer source/bundle, launcher, both arm source trees and exact diff hashes before native launch. Pre/post approved model SHA/mode/size/inode/mtime, prior raw-root hashes, copied originals/marker, overlay hashes and production source hashes must match. Preserve stdout/stderr and boundary logs. After clean exit, assess both arms under rubric uniformly as AGENT inspection; no designated-human score. Parent decides next direction; no automatic second sentence/iteration.
