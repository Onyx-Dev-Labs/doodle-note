# doodle-note-mcp

A read-only [MCP](https://modelcontextprotocol.io) server that gives on-machine AI agents
(Claude Desktop, Claude Code, Codex, and anything else that speaks MCP over stdio)
access to your local DoodleNote meetings, notes, and transcripts.

- **Opt-in**: refuses to start until you enable *Agent access* in DoodleNote's Settings,
  which writes `~/.doodlenote/mcp.json`. Turning the toggle off (or deleting the file)
  revokes access immediately.
- **Read-only**: agents can list, search, and read — never write, edit, or delete.
- **Local**: reads the same on-disk store the app writes (`userData/meetings/`);
  works while the DoodleNote app is closed; nothing leaves your machine.
- **Filtered**: trashed meetings are invisible; echo-suppressed transcript segments are
  excluded, matching what the app shows you.

## Tools

| Tool | Purpose |
|---|---|
| `list_recent_meetings` | Newest-first metadata (`limit`, default 10) |
| `search_meetings` | Keyword search across titles, notes, transcripts |
| `get_meeting` | Metadata for one meeting id |
| `get_meeting_notes` | Rough + AI-generated notes (markdown) |
| `get_meeting_transcript` | Speaker-attributed segments + rendered text |

Every response includes `schema_version`. Meeting ids are DoodleNote's stable UUIDs —
the same ids on every device and in cloud sync.

## Setup

### One click (recommended)

1. In DoodleNote: **Settings → Agent access → Enable**.
2. Click **Connect** next to Claude Desktop, Claude Code, or Codex.

That's it. The server ships inside the DoodleNote app (the app binary doubles as
its Node runtime via `ELECTRON_RUN_AS_NODE`), so there is nothing to install or
build, and the buttons write the client configs for you. **Disconnect** removes
the entry again. For any other MCP client, **Copy snippet** puts a ready-made
`mcpServers` JSON entry on the clipboard.

### Manual

Any MCP client can launch the bundled server directly:

```json
{
  "mcpServers": {
    "doodle-note": {
      "command": "/Applications/DoodleNote.app/Contents/MacOS/DoodleNote",
      "args": ["/Applications/DoodleNote.app/Contents/Resources/mcp/cli.js"],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

Working from a repo checkout instead? Build once with
`pnpm --filter doodle-note-mcp build` and use `node …/packages/doodle-note-mcp/dist/cli.js`
as the command. Once published to npm, `npx doodle-note-mcp` works too.

## Configuration

`~/.doodlenote/mcp.json` (written by the app; `DOODLE_NOTE_MCP_CONFIG` overrides the path):

```json
{
  "enabled": true,
  "meetingsDir": "/Users/you/Library/Application Support/DoodleNote/meetings"
}
```

## Hosted MCP (remote agents)

The same five tools are served remotely at `https://www.doodlenote.ai/api/mcp`,
backed by your cloud-synced meetings instead of the local store — for Claude
web/mobile, cloud Codex, and agents that don't run on your machine. Mint a
read-only agent token in the web app (**Workspaces → AI agents**), then:

```bash
claude mcp add --transport http doodle-note https://www.doodlenote.ai/api/mcp \
  --header "Authorization: Bearer dnag_…"
```

Tokens are workspace-scoped and revocable from the same panel. Remote access
requires cloud sync (it reads the synced copy of your meetings).

## Development

```bash
pnpm --filter doodle-note-mcp test        # unit tests
pnpm --filter doodle-note-mcp typecheck
pnpm --filter doodle-note-mcp build
```

The tool contract (names, arguments, response schemas) lives in
`@repo/agent-contract` and is shared verbatim with DoodleNote's hosted MCP,
so agents built against this server work unchanged against a DoodleNote
account's cloud data.
