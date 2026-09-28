# claude-todo

A lightweight MCP server that gives Claude Code a persistent todo list. Todos are stored in SQLite (built-in `node:sqlite`, WAL mode), so they survive restarts and are safe to use from several Claude sessions at once.

## Requirements

- Node.js >= 22.13

## Setup

```sh
npm install
```

Register it in `.mcp.json` (project) or `~/.claude/.mcp.json` (user):

```json
{
  "mcpServers": {
    "todo": {
      "command": "node",
      "args": ["/absolute/path/to/claude-todo/src/index.js"]
    }
  }
}
```

## Tools

| Tool | Input | Output |
|---|---|---|
| `todo_list` | `limit?` (50), `order?` `asc\|desc`, `range?` `day\|week\|any`, `status?` `open\|done\|all`, `importance?` | `# Todos (...)` + todos |
| `todo_search` | `query`, `limit?` (20), `status?` | `# Search "query" (...)` + todos |
| `todo_add` | `slug`, `prompt`, `date?`, `importance?` `low\|medium\|high` (medium) | `# Added` + todo |
| `todo_update` | `slug`, `prompt?`, `date?` (`null` clears), `importance?` | `# Updated` + todo |
| `todo_done` | `slug` | `# Done` or `# Already done` + todo |
| `todo_delete` | `slug` | `# Deleted <slug>` |

Output is Markdown. Each todo is a section with the checkbox and slug in the heading, one meta item per line, then the prompt as the body:

```markdown
# Todos (2 open, 3 total)

## [ ] iiot-examen-pratique-1
Importance: high
Date: 2026-09-28 08:10

Study chapters 3-5.
Redo the Modbus lab.

## [ ] write-docs
Importance: medium
Date: 2026-10-01

Write the README.

## [x] old-task
Importance: low
Date: none

Old thing
```

- `[ ]` open, `[x]` done.
- `Date` is `YYYY-MM-DD` for all-day todos, local `YYYY-MM-DD HH:MM` for timed ones, or `none`.
- The heading counts cover everything matched; `, showing N` is appended when `limit` cut the results.

Errors return `isError: true` with `# Error <CODE>` followed by the message, where `CODE` is one of `NOT_FOUND`, `SLUG_EXISTS`, `INVALID_DATE`, `INVALID_INPUT`.

### Behavior

- **Ordering**: by date (undated last), then importance (high first), then creation time.
- **Ranges**: `day` = due today or earlier, `week` = due by the end of this week (Monday–Sunday) or earlier. Overdue todos are always included; undated todos only appear with `any`.
- **Dates**: input without a timezone is taken in the local machine timezone.
  - All-day: `today`, `tomorrow`, `YYYY-MM-DD`
  - Timed: `HH:MM[:SS]` (today), `today 14:00`, `tomorrow 09:30`, `YYYY-MM-DD HH:MM[:SS]`, `YYYY-MM-DDTHH:MM[:SS]`
  - Relative: `+30m`, `+2h`, `+1d`, `+1w`
  - ISO 8601 with `Z` or an offset keeps its own zone; it is stored converted to local time.
- **Slugs**: unique among open todos. Adding a slug that belongs to a done todo replaces it. Slugs cannot be changed after creation.
- **Updates**: only the fields passed change. Done todos can be updated too and stay done.
- **Search**: case-insensitive substring match on slug and prompt.

## Configuration

| Var | Default | Meaning |
|---|---|---|
| `TODO_DATA_DIR` | `~/.claude-todo` | Directory holding `todo.db` |
