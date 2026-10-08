import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { parseDate, rangeEnd, rangeBounds, displayDate, PREVIEW_RANGES } from './dates.js';
import { TodoError, addTodo, listTodos, searchTodos, updateTodo, markDone, deleteTodo } from './store.js';

const INSTRUCTIONS = `You have a persistent todo list that survives restarts and is shared across sessions.

Each todo has a slug (its id), a prompt (the task, written as an instruction to yourself),
an importance (low, medium, high) and an optional date.

- todo_add: create a todo. Slugs are lowercase kebab-case and must be unique among open todos.
- todo_list: list todos by date, optionally limited to today ("day") or this week ("week").
  Overdue todos are included in both ranges.
- todo_preview: compact one-line-per-todo overview of a time window ("today", "tomorrow", "week",
  "next_week" or "upcoming"), without prompt bodies. Use it to look ahead cheaply; fetch details with todo_search.
- todo_search: find todos whose slug or prompt contains a substring.
- todo_update: change a todo's prompt, date or importance. The slug cannot be changed. Pass date: null to clear the date.
- todo_done: mark a todo as done.
- todo_delete: permanently remove a todo.

Output is Markdown. Each todo is a section:
  ## [ ] slug                ([x] when done)
  Importance: high
  Date: 2026-09-28 08:10     (YYYY-MM-DD, local YYYY-MM-DD HH:MM, or "none")

  prompt, verbatim, may span several lines
todo_list and todo_search start with "# Todos (<open> open, <total> total)" or "# Search "<query>" (...)",
with ", showing <n>" appended when the limit cut the results.
todo_preview starts with "# Preview <range> (...)" and lists one line per todo:
  - [ ] slug — 2026-09-28 08:10, high — first line of the prompt, cut at 80 chars
Actions return a one-line confirmation: "Added <slug>", "Updated <slug>", "Done <slug>",
"Already done <slug>" or "Deleted <slug>". When todo_add or todo_update was given a date,
a second line "Date: <resolved date>" follows.
Failures: "Error <CODE>: <message>", CODE one of NOT_FOUND, SLUG_EXISTS, INVALID_DATE, INVALID_INPUT.`;

const Importance = z.enum(['low', 'medium', 'high']);
const Status = z.enum(['open', 'done', 'all']);
const Slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase kebab-case, e.g. "fix-auth-timeout"')
  .max(64);

const DATE_HELP = 'Due date. All-day: "today", "tomorrow", "YYYY-MM-DD". Timed, in the local machine timezone: "HH:MM" (today), "today 14:00", "tomorrow 09:30", "YYYY-MM-DD HH:MM[:SS]" or "YYYY-MM-DDTHH:MM[:SS]". Relative: "+30m", "+2h", "+1d", "+1w". An ISO 8601 datetime with Z or an offset keeps its own zone';

function resolveDate(date) {
  const parsed = parseDate(date);
  if (!parsed) throw new TodoError('INVALID_DATE', `Could not parse date "${date}"`);
  return parsed;
}

// A todo as a Markdown section: checkbox and slug in the heading, one meta item per
// line, then the prompt verbatim as the body.
function block(t) {
  const box = t.status === 'done' ? '[x]' : '[ ]';
  const date = t.date ? displayDate(t.date) : 'none';
  return `## ${box} ${t.slug}\nImportance: ${t.importance}\nDate: ${date}\n\n${t.prompt}`;
}

function withDate(line, todo, args) {
  if (args.date === undefined || args.date === null) return line;
  return `${line}\nDate: ${displayDate(todo.date)}`;
}

const PREVIEW_CHARS = 80;

function snippet(prompt) {
  const line = prompt.split('\n', 1)[0].trim();
  return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS - 1).trimEnd()}…` : line;
}

function previewLine(t) {
  const box = t.status === 'done' ? '[x]' : '[ ]';
  return `- ${box} ${t.slug} — ${displayDate(t.date)}, ${t.importance} — ${snippet(t.prompt)}`;
}

function page(title, out) {
  let heading = `# ${title} (${out.open} open, ${out.total} total)`;
  if (out.count < out.total) heading += `, showing ${out.count}`;
  return [heading, ...out.todos.map(block)].join('\n\n');
}

function previewPage(out) {
  let heading = `# Preview ${out.range} (${out.open} open, ${out.total} total)`;
  if (out.count < out.total) heading += `, showing ${out.count}`;
  if (!out.todos.length) return heading;
  return `${heading}\n\n${out.todos.map(previewLine).join('\n')}`;
}

const text = {
  list: out => page('Todos', out),
  preview: previewPage,
  search: out => page(`Search "${out.query}"`, out),
  // Actions only confirm; they don't echo back what the caller just sent. The one
  // exception is a date the server resolved (e.g. "+3d"), which the caller can't know.
  added: (out, args) => withDate(`Added ${out.todo.slug}`, out.todo, args),
  updated: (out, args) => withDate(`Updated ${out.todo.slug}`, out.todo, args),
  done: out => `${out.already_done ? 'Already done' : 'Done'} ${out.todo.slug}`,
  deleted: out => `Deleted ${out.slug}`,
};

function ok(out, format, args) {
  return { content: [{ type: 'text', text: format(out, args) }] };
}

function fail(code, message) {
  return {
    content: [{ type: 'text', text: `Error ${code}: ${message}` }],
    isError: true,
  };
}

function handle(format, fn) {
  return async args => {
    try {
      return ok(fn(args), format, args);
    } catch (e) {
      if (e instanceof TodoError) return fail(e.code, e.message);
      throw e;
    }
  };
}

export function createServer() {
  const mcp = new McpServer(
    { name: 'claude-todo', version: '1.0.0' },
    { instructions: INSTRUCTIONS },
  );

  mcp.registerTool(
    'todo_list',
    {
      description: 'List todos ordered by date (undated last), then by importance (high first).',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().default(50),
        order: z.enum(['asc', 'desc']).optional().default('asc').describe('Date order'),
        range: z
          .enum(['day', 'week', 'any'])
          .optional()
          .default('any')
          .describe('"day": due today or earlier. "week": due by the end of this week (Sunday) or earlier. "any": everything, including undated'),
        status: Status.optional().default('open'),
        importance: Importance.optional().describe('Only return todos of this importance'),
      },
      annotations: { readOnlyHint: true },
    },
    handle(text.list, ({ limit, order, range, status, importance }) =>
      listTodos({ status, importance, before: rangeEnd(range), order, limit }),
    ),
  );

  mcp.registerTool(
    'todo_preview',
    {
      description: 'Compact overview of dated todos in a time window: one line per todo (slug, date, importance, first line of the prompt), no bodies. Cheap way to look ahead; use todo_list for full prompts.',
      inputSchema: {
        range: z
          .enum(PREVIEW_RANGES)
          .optional()
          .default('upcoming')
          .describe('"today": due today or earlier. "tomorrow": due tomorrow only. "week": due by the end of this week (Sunday) or earlier. "next_week": due next Monday through Sunday only. "upcoming": dated and not yet due'),
        limit: z.number().int().min(1).max(200).optional().default(50),
        status: Status.optional().default('open'),
      },
      annotations: { readOnlyHint: true },
    },
    handle(text.preview, ({ range, limit, status }) => ({
      ...listTodos({ status, ...rangeBounds(range), order: 'asc', limit }),
      range,
    })),
  );

  mcp.registerTool(
    'todo_search',
    {
      description: 'Case-insensitive substring search over todo slugs and prompts.',
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(200).optional().default(20),
        status: Status.optional().default('open'),
      },
      annotations: { readOnlyHint: true },
    },
    handle(text.search, ({ query, limit, status }) => {
      if (!query.trim()) throw new TodoError('INVALID_INPUT', 'query must not be blank');
      return { ...searchTodos({ query: query.trim(), status, limit }), query: query.trim() };
    }),
  );

  mcp.registerTool(
    'todo_add',
    {
      description: 'Create a todo. Fails with SLUG_EXISTS if an open todo already uses the slug; a done todo with the same slug is replaced.',
      inputSchema: {
        slug: Slug.describe('Unique id, lowercase kebab-case, e.g. "fix-auth-timeout"'),
        prompt: z.string().min(1).describe('The task, written as an instruction to yourself'),
        date: z
          .string()
          .optional()
          .describe(DATE_HELP),
        importance: Importance.optional().default('medium'),
      },
    },
    handle(text.added, ({ slug, prompt, date, importance }) => {
      if (!prompt.trim()) throw new TodoError('INVALID_INPUT', 'prompt must not be blank');
      const parsed = date !== undefined ? resolveDate(date) : null;
      return { todo: addTodo({ slug, prompt: prompt.trim(), importance, date: parsed }) };
    }),
  );

  mcp.registerTool(
    'todo_update',
    {
      description: 'Update an existing todo, open or done. Only the fields you pass change. The slug cannot be changed.',
      inputSchema: {
        slug: Slug.describe('Slug of the todo to update'),
        prompt: z.string().min(1).optional(),
        date: z.string().nullable().optional().describe(`${DATE_HELP}. Pass null to clear the date`),
        importance: Importance.optional(),
      },
    },
    handle(text.updated, ({ slug, prompt, date, importance }) => {
      if ([prompt, date, importance].every(v => v === undefined)) {
        throw new TodoError('INVALID_INPUT', 'Pass at least one of prompt, date, importance');
      }
      if (prompt !== undefined && !prompt.trim()) throw new TodoError('INVALID_INPUT', 'prompt must not be blank');
      const parsed = date === undefined || date === null ? date : resolveDate(date);
      return {
        todo: updateTodo(slug, { prompt: prompt?.trim(), importance, date: parsed }),
      };
    }),
  );

  mcp.registerTool(
    'todo_done',
    {
      description: 'Mark a todo as done. Calling it on an already-done todo is a no-op and reports already_done: true.',
      inputSchema: { slug: Slug },
      annotations: { idempotentHint: true },
    },
    handle(text.done, ({ slug }) => markDone(slug)),
  );

  mcp.registerTool(
    'todo_delete',
    {
      description: 'Permanently delete a todo, open or done.',
      inputSchema: { slug: Slug },
      annotations: { destructiveHint: true },
    },
    handle(text.deleted, ({ slug }) => deleteTodo(slug)),
  );

  return mcp;
}
