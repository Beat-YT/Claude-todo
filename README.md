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
| `todo_list` | `limit?` (50), `order?` `asc\|desc`, `range?` `day\|week\|any`, `status?` `open\|done\|all`, `importance?` | `count=N total=M` + todo lines |
| `todo_search` | `query`, `limit?` (20), `status?` | `count=N total=M` + todo lines |
| `todo_add` | `slug`, `prompt`, `date?`, `importance?` `low\|medium\|high` (medium) | `added` + todo line |
| `todo_update` | `slug`, `prompt?`, `date?` (`null` clears), `importance?` | `updated` + todo line |
| `todo_done` | `slug` | `done` or `already_done` + todo line |
| `todo_delete` | `slug` | `deleted <slug>` |

Output is plain text. Each todo is a Markdown checklist item on one line, fields in fixed order:

```
count=3 total=5
- [ ] fix-auth | high | 2026-09-28 | Fix auth timeout
- [ ] write-docs | medium | 2026-10-01T14:00:00-04:00 | Write 50% of docs
- [x] old-task | low | - | Old thing
```

- `[ ]` open, `[x]` done.
- `date` is `YYYY-MM-DD` (all-day), ISO 8601 with offset (timed), or `-` (none).
- `prompt` is last so it may contain `|`; newlines in it are escaped as `\n`.
- `count` is how many were returned, `total` how many matched before `limit`.

Errors return `isError: true` with `error <CODE> <message>`, where `CODE` is one of `NOT_FOUND`, `SLUG_EXISTS`, `INVALID_DATE`, `INVALID_INPUT`.

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
