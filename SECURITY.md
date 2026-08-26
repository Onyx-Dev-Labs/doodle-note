# Security policy

## Supported versions

Security fixes target the latest signed desktop release, the current hosted
web service, and the `main` branch. Older desktop releases, abandoned branches,
forks, and self-hosted deployments that have not applied current updates may no
longer receive fixes.

When reporting a desktop issue, include the exact app version. For source or
self-hosted issues, include the commit SHA and deployment model.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability or include real meeting content, tokens, credentials, or account details in a report.

Use [GitHub's private vulnerability reporting](https://github.com/Onyx-Dev-Labs/doodle-note/security/advisories/new). If the form is unavailable, contact the Onyx Dev Labs organization owners through GitHub to establish a private reporting channel. Include:

- the affected component and version or commit;
- reproduction steps or a proof of concept;
- the expected and observed impact;
- any suggested mitigation;
- a safe way to contact you.

We will acknowledge a complete report as soon as practical, investigate it, and coordinate remediation and disclosure with the reporter. Please allow maintainers a reasonable opportunity to fix the issue before public disclosure.

## Scope priorities

We especially value reports involving:

- unintended audio capture or recording lifecycle failures;
- exposure of local meetings, transcripts, notes, or model/provider keys;
- authorization or tenant-isolation failures in cloud sync, sharing, workspaces, billing, or hosted agent access;
- unsafe file import, export, preview, or connector behavior;
- bypasses of the local MCP opt-in or read-only boundary;
- updater, package-signing, or release-integrity vulnerabilities.

General product support, feature requests, and non-sensitive bugs belong in the public issue tracker.

## Deployment safety

Production web deployments must set a unique `BETTER_AUTH_SECRET`. Official
hosted production must also configure the complete Stripe environment group;
self-hosted production must explicitly set `DOODLENOTE_SELF_HOSTED=true`.
Missing or incomplete production configuration fails closed by design.
