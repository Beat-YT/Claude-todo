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
| `todo_list` | `limit?` (50), `order?` `asc\|desc`, `range?` `day\|week\|any`, `status?` `open\|done\|all`, `importance?` | `{ todos, count, total }` |
| `todo_search` | `query`, `limit?` (20), `status?` | `{ todos, count, total }` |
| `todo_add` | `slug`, `prompt`, `date?`, `importance?` `low\|medium\|high` (medium) | `{ todo }` |
| `todo_done` | `slug` | `{ todo, already_done }` |
| `todo_delete` | `slug` | `{ slug, deleted: true }` |

Every todo has the same shape:

```ts
{
  slug: string,                 // lowercase kebab-case id
  prompt: string,
  importance: 'low' | 'medium' | 'high',
  date: string | null,          // YYYY-MM-DD (all-day) or ISO 8601 with offset
  status: 'open' | 'done',
  created_at: string,
  done_at: string | null
}
```

Outputs are declared as MCP `outputSchema`s and returned as `structuredContent`, with the same JSON in the text content. `count` is how many were returned, `total` how many matched before `limit`.

Errors return `isError: true` with `{ "error": { "code", "message" } }`, where `code` is one of `NOT_FOUND`, `SLUG_EXISTS`, `INVALID_DATE`, `INVALID_INPUT`.

### Behavior

- **Ordering**: by date (undated last), then importance (high first), then creation time.
- **Ranges**: `day` = due today or earlier, `week` = due by the end of this week (Monday–Sunday) or earlier. Overdue todos are always included; undated todos only appear with `any`.
- **Dates**: input without a timezone is taken in the local machine timezone.
  - All-day: `today`, `tomorrow`, `YYYY-MM-DD`
  - Timed: `HH:MM[:SS]` (today), `today 14:00`, `tomorrow 09:30`, `YYYY-MM-DD HH:MM[:SS]`, `YYYY-MM-DDTHH:MM[:SS]`
  - Relative: `+30m`, `+2h`, `+1d`, `+1w`
  - ISO 8601 with `Z` or an offset keeps its own zone; it is stored converted to local time.
- **Slugs**: unique among open todos. Adding a slug that belongs to a done todo replaces it.
- **Search**: case-insensitive substring match on slug and prompt.

## Configuration

| Var | Default | Meaning |
|---|---|---|
| `TODO_DATA_DIR` | `~/.claude-todo` | Directory holding `todo.db` |
