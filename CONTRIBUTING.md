# Contributing to DoodleNote

Thanks for helping make private, local-first meeting notes better. Contributions can include bug reports, documentation, tests, accessibility improvements, platform support, and focused product changes.

## Before you start

1. Search existing issues and pull requests to avoid duplicate work.
2. Open an issue for a large feature, architecture change, new service dependency, or change to privacy/data behavior.
3. Keep changes focused. Separate unrelated refactors from the behavior you want reviewed.
4. Never include real meeting data, transcripts, credentials, tokens, signing files, or customer information in an issue, fixture, commit, or pull request.

## Local setup

```sh
git clone https://github.com/Onyx-Dev-Labs/doodle-note.git
cd doodle-note
corepack enable
pnpm install --frozen-lockfile
```

Node.js 22+ is required. Desktop work on macOS also requires macOS 14+, Apple Silicon, and the Xcode command-line tools:

```sh
pnpm engine:build
pnpm --filter desktop dev
```

The web app starts with a local PGlite database and no cloud credentials:

```sh
pnpm --filter web dev
```

See the component READMEs for [desktop](apps/desktop/README.md), [iOS](apps/ios/README.md), [web](apps/web/README.md), the [transcription engine](engine/README.md), and the [local MCP server](packages/doodle-note-mcp/README.md).

## Making a change

- Branch from `main` and use a descriptive branch name.
- Follow the patterns and formatting already used by the package you touch.
- Add or update tests for user-visible behavior, persistence, IPC/API contracts, capture lifecycle, sync, or security boundaries.
- Preserve local-first defaults. New network behavior must be explicit, documented, and safe when its configuration is absent.
- Keep unfinished features gated so release builds do not imply support that is not ready.
- Update documentation when setup, compatibility, permissions, privacy behavior, or contributor commands change.

## Verification

Run the narrowest relevant checks, then expand when your change crosses packages:

```sh
pnpm --filter desktop typecheck
pnpm --filter desktop test
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter doodle-note-mcp test
pnpm --filter @repo/ai test
pnpm engine:build
```

iOS contributors should regenerate the project from `apps/ios/project.yml` and run the unit-test target described in [apps/ios/README.md](apps/ios/README.md). Do not commit a generated `.xcodeproj`.

## Pull requests

In the pull request, explain:

- the user problem and the change;
- the surfaces and data flows affected;
- the checks you ran;
- screenshots or recordings for visual changes;
- privacy, migration, compatibility, and release risks;
- follow-up work that is intentionally out of scope.

By contributing, you agree that your contribution is licensed under the repository's [MIT License](LICENSE).
