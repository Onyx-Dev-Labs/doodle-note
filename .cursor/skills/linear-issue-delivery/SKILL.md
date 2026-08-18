---
name: linear-issue-delivery
description: Implement an approved Linear feature, bug, regression, improvement, chore, spike, security, performance, or infrastructure issue from Agent Build Contract v1 through an isolated Git branch/worktree, verification, pull request, review, and explicit merge or release gates. Use when the user asks Codex, Claude, or another development agent to build, fix, execute, or deliver a Linear issue.
compatibility: Requires repository access and Git. Live Linear progress updates require a connected Linear app; pull-request work requires authenticated access to the Git hosting provider. Platform-specific builds may require the relevant SDK, signing identity, device, or deployment credentials.
metadata:
  author: Onyx Dev Labs
  version: "1.1.0"
---

# Linear Issue Delivery

Execute one implementation-ready Linear issue as one independently reviewable development lane.

The normal stopping point is a tested pull request ready for human QA and review. Merging, deploying, publishing, store submission, updater publication, migration execution, and production release require explicit user authority.

## Core Contract

Use this operating model:

`one Linear issue = one accountable human = one branch/worktree = one active editing agent = one pull request`

The issue's **Agent Build Contract v1** is the delivery interface. Use its outcome, scope, acceptance criteria, repository, base branch, platforms, verification requirements, dependencies, agent stopping boundary, issue completion boundary, and completion evidence. For older contracts with only `Delivery boundary`, interpret it conservatively and never treat a PR-only agent stopping point as permission to mark the product work `Done`.

The issue defines what success means. Repository evidence determines how to implement it safely. Neither the issue nor this skill overrides repository instructions or grants release authority.

## Default Authority

When the user invokes this skill for an issue, the agent is authorized to:

- Read the issue, comments, relationships, and relevant Linear project context
- Resolve the authenticated Linear human and claim an unassigned implementation-ready issue for that same human
- Update ordinary implementation statuses and add concise progress/handoff comments
- Inspect the repository and Git hosting state
- Create or resume one isolated branch and worktree
- Modify code and directly related tests/docs/configuration within issue scope
- Run appropriate local verification
- Commit, push, and open or update one pull request
- Request the repository's configured automated and human review
- Address in-scope review and CI findings on the same branch

The agent is not authorized merely by issue assignment to:

- Merge the pull request
- Deploy to staging or production
- Apply production migrations or backfills
- Publish packages, desktop updater feeds, mobile builds, browser extensions, or store releases
- Change repository protection, access, secrets, billing, DNS, or external customer data
- Expand the issue into unrelated product work

Perform those actions only when the user explicitly authorizes that delivery stage.

## Operating Rules

- Treat `main` or the repository's documented default branch as reviewed code. Do not commit directly to it unless the user explicitly requests that exception.
- Preserve unrelated human and agent work. Never overwrite, discard, reset, or absorb unrelated dirty-worktree changes.
- Never run two editing agents in the same directory, worktree, or branch.
- The Linear assignee is always the accountable human, never Codex, Claude, or another AI agent. Record the AI agent separately in the claim comment or an established delegation label.
- Resolve the authenticated Linear user with `get_user("me")` at the start of every delivery. Use `assignee: "me"` only after that identity is confirmed.
- Never silently take over an issue assigned to another human. Require an explicit, verified ownership handoff and resume the authoritative branch and PR when safe.
- Search for an existing issue branch, worktree, pull request, and active owner before creating another lane. Resume the authoritative lane when safe instead of duplicating work.
- Follow repository instructions such as `AGENTS.md`, `CLAUDE.md`, contribution docs, architecture rules, generated-file policies, version rules, and required checks.
- Keep the diff focused on the issue. Do not hide unrelated refactors inside feature or bug work.
- Treat acceptance criteria as required behavior, not suggestions. Map each criterion to automated or manual evidence.
- Do not present a suspected bug root cause, passing test, review approval, deployment, release, or live behavior as confirmed without authoritative evidence.
- Do not put secrets, tokens, credentials, private keys, sensitive logs, or customer data into commits, PRs, Linear comments, or chat.
- Ask only when a material ambiguity, access boundary, destructive action, or external mutation would change the result. Otherwise make evidence-based assumptions, record them, and continue.

## Required Workflow

Follow these stages in order. Do not skip a gate merely because code compiles or an agent reports success.

### 1. Read and Validate the Linear Issue

- Resolve the authenticated Linear user with `get_user("me")`. Record the returned user ID and display name as the prospective claimant; do not infer identity from the device, task title, Git configuration, or issue author.
- Resolve the exact issue identifier and read the full issue, comments, parent/children, blockers, related issues, project, status, priority, assignee, and labels.
- If the issue is unassigned, it is eligible for this authenticated human to claim after the remaining preflight succeeds. If it is assigned to the authenticated human, resume their authoritative lane. If it is assigned to anyone else, stop unless an explicit handoff has been authorized and recorded.
- Confirm no other developer or agent is actively implementing the same lane. Search claim comments, local and remote branches, local worktrees, open and closed pull requests, and recent commits using the issue ID and likely branch names.
- Read Agent Build Contract v1 and extract:
  - Repository and base branch
  - Issue type and target platforms
  - Required outcome and scope boundaries
  - Acceptance criteria
  - Automated and manual verification
  - Agent stopping boundary and issue completion boundary, or the conservative equivalent for an older contract
  - Dependencies and required completion evidence
- Confirm prerequisite issues/PRs have landed at the required boundary.
- Search the Git host for an existing branch or PR containing the issue ID.
- Compare likely shared or collision-prone areas against active pull requests, especially schemas, migrations, API contracts, authentication, shared UI, generated files, lockfiles, and release/version files.

Do not start implementation when any of these are materially missing:

- No testable outcome or acceptance criteria
- Wrong or unresolved repository/team/project
- A blocking dependency has not landed
- A security, data, or permission decision would require guessing
- The same issue is already active in another authoritative lane

For small non-material omissions, infer from repository evidence and record the assumption in a Linear comment. For material gaps, leave the issue out of `In Progress`, document the blocker, and route it back through issue authoring or the accountable owner.

If Linear is temporarily unavailable but the user supplies a complete exported issue and contract, implementation may continue only when the target and scope are unambiguous. Defer status updates and never claim they occurred.

### 2. Inspect Repository and Delivery Context

Before editing:

- Confirm the repository root, remotes, current branch, status, existing worktrees, and recent relevant commits using non-destructive Git commands.
- Read all applicable repository instructions completely.
- Inspect the issue's likely code paths, existing patterns, tests, schemas, migrations, release configuration, and deployment boundaries.
- Verify current external documentation when the implementation depends on a drift-prone API, SDK, platform rule, standard, or service behavior.
- Identify shared files or foundations being modified by other active work.
- When active work overlaps a shared foundation, establish dependency and merge order before editing. Worktree isolation prevents filesystem collisions, not incompatible contracts or integration conflicts.
- Determine the repository's actual package manager and test, lint, typecheck, build, packaging, and smoke commands.

If the primary checkout is dirty, preserve it and use a clean isolated worktree. Do not use destructive cleanup to make the task convenient.

### 3. Create or Resume the Isolated Lane

- Re-read the issue, assignee, status, claim comments, branches, worktrees, and pull requests immediately before claiming. If a competing claim or lane appeared, stop.
- If unassigned, claim the issue with `assignee: "me"`; read it back and confirm the assignee ID matches the earlier `get_user("me")` result. If already assigned to that same authenticated user, continue. Never replace a different assignee as part of an ordinary claim.
- Add a provisional `Implementation Claim` comment identifying the accountable human, AI agent, repository, intended base branch, task/session reference when available, and start time. Read the issue and comments back before creating a new lane.
- Fetch or otherwise inspect the current remote base branch without overwriting local changes and record the base commit.
- Use the branch pattern from Agent Build Contract v1, normally `<developer>/<ISSUE-ID>-<short-slug>`, where `<developer>` represents the authenticated human rather than the AI agent.
- Create an isolated worktree from the latest safe base, or resume the existing issue worktree/branch after verifying ownership, assignee, and state.
- Install dependencies using the repository's locked/reproducible method.
- Run a targeted baseline check before edits when practical.
- Record existing failures separately so they are not misrepresented as regressions caused by this issue.
- Move the Linear issue to `In Progress` only after the implementation lane exists and work has actually begun. Update the provisional claim comment with the branch, base commit, session/worktree owner, expected touchpoints, baseline result, planned verification, and agent stopping boundary.
- Read the issue and claim comment back. Confirm authenticated assignee, `In Progress` status, branch, and absence of a competing claim before the first product edit.

Use this claim shape:

```markdown
## Implementation Claim
- Owner: <authenticated Linear human>
- Agent: Codex | Claude | other
- Task/session: <reference when available>
- Repository: <owner/repo>
- Base branch and commit: <branch> @ <sha>
- Branch: <developer/ISSUE-ID-slug>
- Worktree/session owner: <human and agent>
- Expected touchpoints: <shared areas or modules>
- Baseline: <commands and result>
- Planned verification: <commands and human QA>
- Agent stopping boundary: <tested PR, merge, deployment, or release>
- Started: <timestamp and timezone>
```

If claim setup fails before product edits and no earlier lane exists, document the failure and return the issue to the appropriate claimable or blocked state. Clear a newly added self-assignment only when it is still owned by the authenticated claimant and no work would be orphaned.

Do not create an empty pull request solely to change status. For longer work, open a draft PR after the first meaningful commit; for shorter work, open it after local verification.

### 4. Build According to Issue Type

#### Feature or Improvement

- Trace the existing user/system workflow before editing.
- Implement the smallest coherent behavior that satisfies every in-scope acceptance criterion.
- Reuse established architecture, state management, UI components, API patterns, accessibility conventions, analytics, and error handling.
- Cover applicable loading, empty, success, error, disabled, offline, permission, responsive, and persistence states.
- Preserve explicitly out-of-scope and regression-sensitive behavior.

#### Bug or Regression

- Reproduce the problem or create a failing test before changing behavior when practical.
- Identify the root cause from evidence before choosing the fix.
- Make the smallest safe root-cause fix; avoid broad refactors unless necessary for correctness.
- Add a regression test, or document why an automated regression test is impractical and provide stronger manual evidence.
- Verify the original reproduction no longer fails and adjacent workflows still behave correctly.

#### Research Spike

- Do not ship production behavior unless the issue explicitly includes it.
- Produce the required decision artifact, experiment, benchmark, prototype, or recommendation.
- Record evidence, options, tradeoffs, and the recommended next issue shape.
- Use a docs-only PR only when the repository stores the required artifact there; otherwise deliver through the approved Linear/documentation surface.

#### Data, Security, Integration, or Infrastructure

- Preserve authentication, authorization, tenant isolation, audit, privacy, and secret-handling boundaries.
- Make schema and API changes backward compatible when required.
- Include safe migration, validation, backfill, rollback, retry, rate-limit, idempotency, concurrency, webhook/cron, and partial-failure handling as applicable.
- Add monitoring or operational evidence when required by the contract.
- Never apply a production migration or mutate live data without explicit authority.

### 5. Verify Before Handoff

Run verification proportional to risk and the repository's conventions:

- The targeted failing/regression test or feature-specific tests
- Relevant broader unit, integration, end-to-end, or contract tests
- Lint, formatting, typecheck, static analysis, and generated-file checks
- Production build or platform build
- Migration/schema validation without applying live changes
- Security/permission/tenant tests when affected
- Packaging, signing, launch, device, simulator, browser, or extension checks when locally available and authorized
- Manual smoke checks for observable behavior

For each acceptance criterion, record one of:

- Verified automatically with the exact command/test
- Verified manually with steps and evidence
- Requires accountable human QA
- Blocked, with the exact reason

Do not call the issue verified because one targeted test passed. Distinguish passing checks, skipped checks, unavailable environments, and pre-existing failures.

### 6. Self-Review the Complete Diff

Before commit and PR:

- Review `git status`, the complete diff, and the changed-file list.
- Confirm every changed file belongs to the issue.
- Check for accidental generated artifacts, debug logging, disabled safeguards, secret material, unrelated formatting, and broad lockfile churn.
- Re-check error handling, edge cases, permissions, data consistency, compatibility, and rollback implications.
- Re-run focused verification after self-review fixes.
- Stage only intended paths and create concise commits that explain the change.

### 7. Push and Open the Pull Request

- Push the issue branch without force-pushing over other work.
- Open one PR into the contract's base branch, using `[<ISSUE-ID>] <issue title>` unless repository convention requires another format.
- Link the Linear issue using the issue ID and supported integration syntax.
- Move the Linear issue to `In Review` only after the PR exists and initial local verification is complete.
- Add the PR link and verification summary to Linear when automation has not already done so.
- Read the issue back after GitHub or Linear automation runs. If the status is already correct, do not create a competing update; otherwise apply the team-equivalent `In Review` state and verify it.

Use this PR description shape:

```markdown
## Linear Issue
- <ISSUE-ID and link>

## Outcome
- User/system outcome delivered

## What Changed
- Focused implementation summary

## Bug Evidence / Root Cause
- Reproduction, confirmed root cause, and regression protection when applicable

## Acceptance Criteria Evidence
- [x] Criterion — test or manual evidence
- [ ] Criterion — requires human QA or is blocked

## Verification
- `exact command` — pass/fail/pre-existing failure
- Manual checks and screenshots

## Local QA
1. Exact setup and launch command
2. Happy-path steps
3. Failure/edge/regression steps

## Risks and Release Notes
- Migration, rollout, rollback, compatibility, monitoring, packaging, signing,
  scheduler, updater, store, or deployment notes

## Follow-ups
- Explicitly out-of-scope discoveries; no silent scope expansion
```

Request the repository's configured automated reviewer, such as Greptile or Gitlet, and the required human reviewers. Automated review supplements rather than replaces accountable human review and product QA.

### 8. Human QA and Review Gate

Provide the accountable developer with exact local QA instructions. For user-visible changes, include representative data/account setup, launch commands, happy path, failure states, regression checks, and expected results.

Do not move to `Ready to Merge` until there is evidence that:

- Required CI is green or any exception is explicitly accepted
- Required human and automated reviews are complete
- Actionable comments are resolved
- Acceptance criteria are mapped to evidence
- Required human product QA has passed
- Migrations, rollout, and release risks are understood

When these gates pass, move the issue to `Ready to Merge` and verify the status. Humans provide product QA and approval decisions; the agent performs and verifies the corresponding routine Linear status mutation.

When review or CI findings arrive:

- Classify each as a real issue, needs clarification, optional improvement, or likely false positive.
- Fix real in-scope issues on the same branch and PR.
- Explain false positives or deferred work in the PR when useful.
- Re-run affected verification and update the evidence.
- Request another review pass when needed.
- Do not open a replacement PR unless the existing lane is unusable and the user approves the change.

### 9. Merge Gate

Stop after the reviewed PR unless the user explicitly authorizes merge.

After explicit merge approval:

- Re-read current PR state rather than relying on an earlier snapshot.
- Confirm required CI, approvals, unresolved comments, base branch, mergeability, and intended files.
- Confirm the approved merge strategy and whether merge automatically triggers a deployment.
- Merge through the Git host using the repository's normal non-destructive method.
- Verify the authoritative merge commit on the remote default branch.
- Update Linear to the team's `Awaiting Release` or equivalent state when the issue completion boundary requires a later deployment, migration, package, publication, or installed-client result. If authoritative merge is the defined issue completion boundary, move to `Done` only after verifying the remote merge and required evidence.

A successful merge does not prove a deployment, migration, scheduled job, updater feed, store build, or installed client outcome.

### 10. Release and Delivery-Boundary Gate

Perform deployment, production migration, packaging, notarization, signing, publishing, store submission, updater-feed changes, or installed-client verification only after explicit authority for that stage.

Verify every relevant boundary separately:

- Source: approved commit exists on the authoritative branch
- CI/artifact: required build completed and the expected artifact exists
- Database: migration/backfill is applied and validated in the intended environment
- Hosting: the intended deployment is active
- Scheduler/webhook: registration and real delivery evidence exist
- Package/update feed/store: the new version is publicly available through the intended channel
- Installed/runtime outcome: the actual client or production workflow reports and demonstrates the intended version/behavior
- Rollback/monitoring: failure detection and recovery path are available when required

Move the issue to `Done` only when the Agent Build Contract's issue completion boundary and completion evidence are satisfied. The agent stopping boundary controls authority and where the agent pauses; it never makes an unmerged PR complete. Otherwise use the team's `Awaiting Release`, `Ready for QA`, `In Review`, or equivalent state and document what remains.

## Linear Status Model

Map to the team's actual statuses, but preserve these meanings:

- **Ready:** implementation-ready, dependencies resolved, no coding started; may be unassigned in an approved claim queue
- **In Progress:** authenticated human claim is verified, isolated lane exists, and implementation is active
- **In Review:** PR exists with initial local verification
- **Ready to Merge:** CI, required reviews, resolved comments, acceptance evidence, and required human QA are complete
- **Awaiting Release:** authoritative merge is verified but the issue completion boundary is not
- **Done:** the issue completion boundary is authoritatively verified; a PR-only stopping boundary is never sufficient
- **Blocked:** a named dependency, decision, access boundary, or environment prevents safe progress and is recorded with next owner/action

The agent owns routine status maintenance after delivery is invoked. Apply each transition, read it back, and report failures; the human should not have to move ordinary statuses manually. If native Linear/GitHub automation already made the evidence-correct transition, verify it rather than writing a duplicate update. Do not use status changes as completion evidence; derive status from evidence.

Failed CI or requested review changes normally remain `In Review`, not `Blocked`. Move from `Blocked` only after the named blocker is resolved and the authenticated owner resumes or releases the claim. Use the team's actual status names and preserve these meanings when exact labels differ.

## Ownership Handoff and Claim Release

Do not auto-steal a stale claim. When ownership changes:

1. The current human stops their editing agent and pushes all intended commits.
2. Record the branch, latest commit, PR, verification results, remaining work, risks, and blocker state in Linear.
3. Reassign the issue only with explicit authority from the current owner or user controlling the workflow, then read back the new assignee.
4. The new authenticated human verifies `get_user("me")`, resumes the same authoritative branch/worktree or creates a safe local worktree for that branch, and updates the existing PR.
5. Do not open a replacement branch or PR unless the existing lane is unusable and that decision is recorded.

After verified merge and any required evidence handoff, remove a task worktree only when it has no uncommitted or unpushed changes and repository or agent-host policy permits cleanup. Never delete an unmerged branch with unique work. Unblock dependent issues after the authoritative prerequisite boundary is verified.

## Scope Discovery and Follow-ups

When implementation reveals additional work:

- Fix it in the current PR only when it is necessary to satisfy the issue safely and remains reviewable.
- Record optional or unrelated improvements as suggested follow-ups in the PR/Linear comment.
- Do not create new Linear issues or expand scope unless the user authorizes issue creation or invokes the issue-authoring workflow.
- If a newly discovered prerequisite invalidates the current issue, stop, preserve the branch, document the blocker, and return the issue to the appropriate state.

## Failure and Blocker Handling

- Preserve work and report the exact command, error, environment, and next required action.
- Separate pre-existing failures from failures introduced by the branch.
- Do not weaken tests, permissions, validation, signing, or CI merely to make checks pass.
- Do not leave an issue silently `In Progress` when work cannot continue.
- When a material blocker prevents progress, move the issue to `Blocked` or the team equivalent, add the exact blocker and next required owner/action, and read the mutation back.
- Do not mark the task blocked merely because work is difficult; exhaust safe in-scope diagnostics first.
- Never claim that a status, comment, push, PR, review, merge, deploy, publish, or release occurred without authoritative read-back.

## Completion Reports

### PR Handoff

Report:

- Linear issue and current status
- Authenticated Linear claimant and verified assignee
- Branch/worktree and PR link
- Outcome and files/components changed
- Acceptance-criteria evidence
- Exact verification commands and results
- Local human QA instructions
- Review/CI state
- Risks, migrations, release requirements, and follow-ups
- The next approval gate

### Merge or Release Handoff

Report only verified boundaries:

- Merge commit and authoritative branch state
- Deployment/artifact/migration/publication evidence as applicable
- Production or installed-runtime verification
- Linear final status and remaining gaps
- Recovery/rollback notes when relevant

## Prompt Shapes

Implement through PR:

```text
Use linear-issue-delivery.

Issue: ONYX-123

Resolve the authenticated Linear user with get_user("me"), verify or claim the issue
without taking over another human's lane, read the claim back, then implement the full
Agent Build Contract v1 in an isolated worktree through local verification and one
pull request. Maintain evidence-based Linear statuses automatically. Do not merge,
deploy, publish, or release without explicit approval.
```

Address review:

```text
Use linear-issue-delivery for ONYX-123 and its existing PR.

Read current CI and all unresolved review feedback, address real in-scope findings
on the same branch, re-run affected verification, update the PR and Linear evidence,
and stop at the merge gate.
```

Approve merge only:

```text
Use linear-issue-delivery for ONYX-123. Local QA is approved.

Re-check current CI, approvals, comments, mergeability, and issue evidence. If all
required gates pass, merge the existing PR using the repository's normal strategy,
verify the remote merge commit, and update Linear. Do not perform a separate release
or production mutation unless it is an automatic consequence already documented.
```

Approve release:

```text
Use linear-issue-delivery for ONYX-123. The PR is merged and release is approved.

Follow the repository's release instructions, verify each required delivery boundary
authoritatively, update Linear only from evidence, and report any boundary that remains
incomplete. Do not claim installed or production success from CI alone.
```
