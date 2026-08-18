---
name: linear-issue-authoring
description: Research and turn product ideas, feature requests, bugs, regressions, chores, spikes, and improvements into implementation-ready Linear issues for AI-assisted development, then rename the current Codex task to the confirmed primary issue. Use when the user asks to plan, spec, break down, or create Linear work before Codex, Claude, or another developer implements it.
metadata:
  author: Onyx Dev Labs
  version: "1.2.0"
---

# Linear Issue Authoring

Turn a user's product intent into researched, testable Linear issues that another human or AI agent can implement without rediscovering the problem or guessing at scope.

This skill plans and creates work. It does not implement code, open pull requests, merge, deploy, publish, or release.

Live issue creation requires repository access and a connected Linear app. Current external APIs, platform rules, or standards may also require web access.

## Core Contract

Use this operating model:

`one independently reviewable issue = at most one accountable human at a time = one branch/worktree = one active editing session = one pull request`

A `Ready` issue may remain unassigned when the implementer is not yet known. The accountable human is established either during authoring when explicitly selected or during the delivery claim. Never infer that the person authoring the issue will also implement it.

Every implementation issue must contain an **Agent Build Contract v1**. The future implementation skill should be able to read that contract and determine what to build, where to investigate, how to verify it, and where its authority stops.

## Operating Rules

- Research before creating issues. Treat the user's request as product intent, not a complete technical specification.
- Read current Linear, repository, and Git-host context before writing. Search for duplicate issues and existing branches, worktrees, commits, or pull requests that already represent the work.
- Perform duplicate detection during research and again immediately before live creation. Never create a parallel issue because an earlier search became stale.
- Keep the implementing human as the accountable Linear assignee. If no implementer is explicitly known, leave the issue unassigned for delivery claim rather than assigning the author by default. Record an AI agent as delegation metadata or an existing label only when the team's workflow supports it.
- Create issues that are independently reviewable and normally deliverable through one focused pull request.
- Prefer one complete issue over unnecessary fragmentation. Split only when work has separate dependencies, ownership, review boundaries, deployment risks, or independently valuable outcomes.
- Separate shared foundations such as schemas, API contracts, shared components, generated clients, and dependency upgrades into prerequisite issues when several features depend on them.
- Do not silently invent product behavior, priority, dates, estimates, root causes, customer impact, or technical facts. Mark uncertain information as an assumption or open question.
- Distinguish confirmed evidence, reasonable inference, and unresolved questions.
- Do not prescribe a speculative implementation when the outcome and constraints are sufficient. Technical notes guide investigation; acceptance criteria define success.
- Do not put credentials, tokens, private keys, production secrets, personal data, or sensitive customer content into Linear.
- If the user asked to create the issues and the scope is sufficiently clear, create them without requesting routine approval. Pause only for a material ambiguity that would change the product outcome, mutation target, security boundary, or issue structure.
- Never claim an issue was created until a read-back from Linear confirms its identifier and fields.
- After confirmed live creation, rename the current Codex task to the primary issue identifier and short title when the task-title tool is available. Do not rename from a draft, attempted creation, or unverified response.

## Resolve the Working Context

Infer or confirm these inputs before creation:

- Product/project name
- Repository and default branch
- Linear workspace, team, and project
- Request type: feature, bug, regression, improvement, chore, research spike, security, performance, or release work
- Intended user and desired outcome
- Affected platforms and delivery boundary: web, API, worker, macOS, Windows, iOS, Android, extension, integration, or infrastructure
- Priority and target milestone/cycle, if the user supplied them or an established policy determines them
- Accountable human owner, when explicitly known; otherwise mark the issue as available for authenticated delivery claim
- Source evidence: user report, screenshot, logs, existing issue, support request, analytics, code, or documentation

Use the current repository and established Linear project when they are unambiguous. Ask only when choosing incorrectly would create work in the wrong team/project or materially change the result.

If Linear tools are unavailable, do not claim live creation. Explain that the Linear connection is required and return the finished issue draft only when that helps preserve the research.

## Required Workflow

Follow these steps in order.

### 1. Read Linear First

- Resolve the target workspace, team, project, available statuses, existing labels, members, milestones, and cycles as needed.
- Search open, duplicate, canceled, and recently completed issues using the product name, requested behavior, affected surface, error text, expected result, and likely synonyms.
- Read likely duplicates, parent issues, blockers, and related roadmap work.
- Reuse existing labels and workflow states. Do not create new projects, teams, labels, cycles, or milestones unless they are necessary and within the user's request.
- If an open issue already captures the same outcome, update or enrich that authoritative issue when within scope instead of creating parallel work.
- If a completed issue has genuinely regressed, create a new regression issue and relate it to the original rather than reopening it silently.

### 2. Research the Repository Read-Only

Do not edit product code while authoring issues.

- Read repository instructions such as `AGENTS.md`, `CLAUDE.md`, `README`, architecture notes, and contribution guidance.
- Inspect Git status, branch, remotes, recent history, and relevant open work without overwriting local changes.
- Search local and remote branches, worktrees, open and recently merged pull requests, and relevant commits for the issue intent, affected surface, error text, and any related issue IDs.
- Use `rg` and `rg --files` to locate the affected routes, views, services, commands, schemas, migrations, tests, feature flags, deployment files, and release/version sources.
- Identify current behavior and existing patterns from evidence.
- Identify likely code areas, boundaries, integrations, data contracts, permissions, and regression surfaces.
- Locate the repository's real test, lint, typecheck, build, packaging, and smoke-test conventions.
- Record paths as investigation starting points, not a mandate to edit every named file.

For a bug, reproduce it when safe and practical. If reproduction is unavailable, document the evidence and environment needed by the implementation agent. Never present a suspected root cause as confirmed.

### 2A. Decide Whether Work Already Exists

Classify each likely match before authoring:

- **Exact open duplicate:** enrich the existing issue; do not create another.
- **Partial overlap:** create a related sub-issue only for independently deliverable missing scope.
- **Completed work that regressed:** create a linked regression issue with new evidence.
- **Existing branch or PR without a Linear issue:** adopt and link the active lane when ownership and scope are clear; do not create competing implementation work.
- **Materially different outcome:** create a separate issue and explicitly relate the work.

Title similarity alone is not enough. Compare the desired outcome, affected product surface, repository, platform, evidence, scope, and acceptance criteria.

### 3. Research External Requirements When Needed

Use current primary sources when the request depends on an external API, operating-system rule, platform policy, library version, security standard, or vendor behavior that may have changed.

- Prefer official documentation, specifications, or original research.
- Capture only facts that affect scope, constraints, acceptance criteria, or testing.
- Link the source in the issue when it will help implementation or review.
- Clearly label conclusions inferred from sources.

Do not browse merely to pad the issue. Research should reduce implementation uncertainty.

### 4. Classify and Shape the Work

Choose one of these shapes:

- **Single issue:** one focused outcome that can normally be implemented and reviewed in one PR.
- **Parent plus sub-issues:** a larger outcome with multiple independently implementable lanes.
- **Prerequisite plus dependent issues:** shared foundation must merge before product work can proceed safely.
- **Research spike followed by implementation:** a material technical or product unknown prevents testable implementation scope.

Split work when any of these are true:

- The issue mixes unrelated user outcomes.
- Different repositories, platforms, or owners can deliver independently.
- A schema/API/foundation change is shared by multiple downstream issues.
- Migration, rollout, or security work needs separate review and rollback.
- The expected diff is too broad for reliable review.
- One portion can deliver value while another remains blocked.

Do not create separate issues solely for ordinary coding, unit tests, documentation updates, or PR review when those are part of one deliverable's definition of done.

### 5. Write Implementation-Ready Issues

Use concise outcome-oriented titles:

- Feature: `Add manual mailbox refresh`
- Bug: `Prevent blank inbox after Gmail connection`
- Performance: `Reduce initial dashboard load time`
- Security: `Enforce tenant ownership on public quote access`

Avoid vague titles such as `Fix sync`, `UI updates`, or `Improve app`.

Every implementation issue description must use this structure:

```markdown
## Outcome
What will be observably better, for whom, and why it matters.

## Current Behavior / Evidence
Confirmed current behavior, source of the request, reproduction evidence, logs,
screenshots, relevant existing issues, or code-grounded findings.

## Desired Behavior
The user-visible or system-visible result. Describe behavior, not just files to edit.

## Scope
- In scope: ...
- Out of scope: ...

## Acceptance Criteria
- [ ] Testable, observable criterion
- [ ] Relevant failure, empty, loading, permission, persistence, or edge state
- [ ] Regression-sensitive behavior that must remain intact

## Technical Context
- Repository: ...
- Default branch: ...
- Affected platform(s): ...
- Likely investigation areas: ...
- Existing patterns/contracts to preserve: ...
- Data, API, authentication, authorization, tenant, audit, or migration notes: ...

## Dependencies and Relationships
- Parent: ...
- Blocks / blocked by: ...
- Related issues or PRs: ...

## Verification Plan
- Automated tests: ...
- Static checks/build/package checks: ...
- Manual QA: ...
- Delivery-boundary verification: ...

## Release and Risk Notes
- Rollout, migration, backfill, feature flag, compatibility, rollback, monitoring,
  packaging, signing, store submission, scheduler, or updater-feed considerations.

## Assumptions and Open Questions
- Confirmed assumption or unresolved question, with implementation impact.

## Agent Build Contract v1
- Issue type: ...
- Accountable owner: `<named Linear human>` | `Unassigned until authenticated delivery claim`
- Repository: ...
- Base branch: ...
- Target platform(s): ...
- Required outcome: ...
- Scope boundaries: ...
- Required automated verification: ...
- Required manual verification: ...
- Agent stopping boundary: tested PR | merge | staging | production | packaged release
- Issue completion boundary: merged | deployed | migrated | published | installed and verified
- Dependencies that must land first: ...
- Suggested branch pattern: `<developer>/<ISSUE-ID>-<short-slug>`
- Suggested PR title: `[<ISSUE-ID>] <issue title>`
- Claim required before editing: Yes
- Expected shared or collision-prone areas: ...
- Active prerequisite branches or PRs: ...
- Required human reviewer and QA gate: ...
- Status lifecycle: Ready -> In Progress -> In Review -> Ready to Merge -> Awaiting Release -> Done
- External CRM/project reference: ...
- Merge/deploy/release authority: Not granted by this issue; requires explicit user approval.
- Completion evidence required: PR, checks, QA evidence, deployment/release evidence as applicable.
```

Remove empty boilerplate only when a section truly cannot apply. Preserve the Agent Build Contract on every implementation issue.

## Type-Specific Requirements

### Feature or Improvement

Include:

- Target user and user story or job to be done
- Entry point and primary workflow
- UI states when relevant: loading, empty, success, error, disabled, offline, permission denied
- Edge cases and compatibility expectations
- Accessibility, responsive behavior, telemetry, feature flags, and rollout when relevant
- Behavior that must remain unchanged

### Bug or Regression

Include:

- Actual behavior
- Expected behavior
- Reproduction steps
- Environment, platform, version, account/provider, and frequency when known
- User/business impact and severity evidence
- Earliest known good/bad version or suspected regression window when known
- Logs, screenshots, stack traces, or failing tests with sensitive data removed
- Confirmed or suspected root cause, clearly labeled
- Required regression test or explanation of why one is impractical

### Research Spike

Include:

- Decision the research must enable
- Questions to answer
- Options and constraints to evaluate
- Time or evidence boundary
- Required artifact or recommendation
- Explicit statement that production implementation is out of scope

### Data, Security, Integration, or Infrastructure Work

Include as applicable:

- Schema and data-contract changes
- Migration, backfill, validation, and rollback strategy
- Authentication, authorization, tenant isolation, audit, privacy, and secret-handling constraints
- Rate limits, retries, idempotency, concurrency, webhook/cron behavior, and partial failure
- Compatibility and versioning requirements
- Monitoring, alerting, operational ownership, and authoritative production checks

## Acceptance Criteria Standard

Acceptance criteria must be observable and falsifiable.

Good:

- `When a second sync request arrives while one is active, the API returns the existing job and does not start a duplicate provider sync.`
- `A user without quote access receives a non-enumerating not-found response and no quote data is returned.`

Weak:

- `Sync works correctly.`
- `Handle errors.`
- `Make the UI clean.`

Cover only relevant categories, but deliberately consider:

- Happy path
- Validation and failure states
- Loading and empty states
- Permissions and tenant isolation
- Persistence after reload/restart
- Duplicate requests, concurrency, and idempotency
- Accessibility and responsive layouts
- Backward compatibility and regression behavior
- Audit/telemetry/monitoring
- Packaging, deployment, or installed-client outcome

## Linear Field Rules

- **Team:** required; use the team that owns the code and workflow.
- **Project:** use the product/project that owns the outcome.
- **Status:** use `Ready` only when research, acceptance criteria, dependencies, repository, verification, and delivery boundaries are sufficient for implementation. A team-approved claim queue may contain unassigned `Ready` issues. Otherwise use `Backlog`, `Triage`, `Blocked`, or the team's equivalent.
- **Priority:** derive from evidenced impact and urgency. Do not inflate priority because the request is new.
- **Assignee:** use the explicitly named implementing human. If the implementer is unknown, leave the issue unassigned for delivery claim; never default to the authenticated authoring user merely because they created the issue.
- **Labels:** reuse existing type, platform, component, risk, or agent-delegation labels. Avoid label sprawl.
- **Estimate:** set only when the team uses estimates and the researched scope supports one.
- **Cycle/milestone:** set only when an established plan or explicit user direction supports it.
- **Relationships:** set parent, duplicate, related, blocks, and blocked-by relationships explicitly.

## Create and Verify in Linear

1. Explain the proposed grouping when creating multiple issues.
2. Immediately before each live creation, repeat the Linear and Git-host duplicate search. If authoritative work appeared during research, stop creation and update or link that lane instead.
3. Create the parent or prerequisite issue first.
4. Create children or dependents with the proper project, team, explicitly known owner or unassigned claim state, labels, and relationship identifiers.
5. Add explicit blocking relationships and preserve the intended delivery order.
6. Read every created or updated issue back from Linear.
7. Confirm title, description, status, project, assignee, labels, parent, dependencies, and URL. For an unassigned claim-pool issue, confirm that no accidental author assignment occurred.
8. Correct material omissions before reporting completion.
9. Select the primary issue for the current task:
   - Use the only issue when one issue was created.
   - Use the parent when a parent with sub-issues was created.
   - For multiple unrelated issues, use the issue identified as the recommended first implementation lane.
10. In the Codex app, call `set_thread_title` for the calling task with no explicit thread ID. Format the title as `<ISSUE-ID> (<short issue title>)`, for example `ONY-123 (Prevent blank inbox after Gmail connection)`.
11. Build the task title only from the confirmed Linear identifier and title. Collapse whitespace, remove markdown/newlines, preserve the issue ID, and shorten the descriptive portion at a word boundary when needed to keep the complete task title at roughly 80 characters or fewer.
12. Treat task renaming as a non-blocking convenience after successful issue creation. If the task-title tool is unavailable or the rename fails, preserve the created issues, report the naming gap, and never claim the task was renamed.

Do not move a new issue to `In Progress`; implementation has not begun. Do not mark an issue `Done` based on issue creation or planning completeness.

## Completion Report

Return a compact handoff containing:

- Created or updated issue IDs and links
- Parent/child or dependency map
- Team, project, status, priority, and accountable owner
- Research performed and important evidence
- Assumptions or unanswered questions that remain in the issues
- Which issue should be implemented first
- Whether every implementation issue contains Agent Build Contract v1
- Whether ownership is explicitly assigned or available for authenticated delivery claim
- Duplicate and active-work searches performed, including any existing issue, branch, worktree, or PR adopted instead
- The resulting Codex task title, or a clear note that task renaming was unavailable or failed

If creation was blocked by Linear access, distinguish the completed research/draft from the uncompleted external mutation.

## Prompt Shapes

Feature:

```text
Use linear-issue-authoring.

Project: NARRA Mail
Request: Add a manual mailbox refresh action.
Why: Users need a way to request an immediate sync when waiting for a message.

Research the current product and repository, check Linear for related work, decide
whether this is one issue or a parent with sub-issues, and create implementation-ready
Linear issues with Agent Build Contract v1. Do not implement the feature.
```

Bug:

```text
Use linear-issue-authoring.

Project: NARRA Mail
Problem: Some users see a blank inbox after connecting Gmail.
Evidence: Screenshot attached; noticed after OAuth on iOS.
Expected: Synced messages or an explicit loading, empty, or error state.

Research and reproduce when safe, inspect related code/tests and Linear issues, then
create the smallest implementation-ready bug issue set. Distinguish confirmed facts
from suspected causes. Do not fix the bug.
```
