import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { parseDate, rangeEnd, displayDate } from './dates.js';
import { TodoError, addTodo, listTodos, searchTodos, updateTodo, markDone, deleteTodo } from './store.js';

const INSTRUCTIONS = `You have a persistent todo list that survives restarts and is shared across sessions.

Each todo has a slug (its id), a prompt (the task, written as an instruction to yourself),
an importance (low, medium, high) and an optional date.

- todo_add: create a todo. Slugs are lowercase kebab-case and must be unique among open todos.
- todo_list: list todos by date, optionally limited to today ("day") or this week ("week").
  Overdue todos are included in both ranges.
- todo_search: find todos whose slug or prompt contains a substring.
- todo_update: change a todo's prompt, date or importance. The slug cannot be changed. Pass date: null to clear the date.
- todo_done: mark a todo as done.
- todo_delete: permanently remove a todo.

Output is Markdown. Each todo is a section:
  ## [ ] slug            ([x] when done)
  high · 2026-09-28 08:10   (importance, then date if set: YYYY-MM-DD or local YYYY-MM-DD HH:MM)

  prompt, verbatim, may span several lines
todo_list and todo_search start with "# Todos (<open> open, <total> total)" or "# Search "<query>" (...)",
with ", showing <n>" appended when the limit cut the results.
todo_add, todo_update and todo_done start with "# Added", "# Updated", "# Done" or "# Already done", then the todo.
todo_delete returns "# Deleted <slug>".
Failures: "# Error <CODE>" then the message, CODE one of NOT_FOUND, SLUG_EXISTS, INVALID_DATE, INVALID_INPUT.`;

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

// A todo as a Markdown section: checkbox and slug in the heading, importance and
// date on the next line, then the prompt verbatim as the body.
function block(t) {
  const box = t.status === 'done' ? '[x]' : '[ ]';
  const meta = t.date ? `${t.importance} · ${displayDate(t.date)}` : t.importance;
  return `## ${box} ${t.slug}\n${meta}\n\n${t.prompt}`;
}

function page(title, out) {
  let heading = `# ${title} (${out.open} open, ${out.total} total)`;
  if (out.count < out.total) heading += `, showing ${out.count}`;
  return [heading, ...out.todos.map(block)].join('\n\n');
}

const text = {
  list: out => page('Todos', out),
  search: out => page(`Search "${out.query}"`, out),
  added: out => `# Added\n\n${block(out.todo)}`,
  updated: out => `# Updated\n\n${block(out.todo)}`,
  done: out => `# ${out.already_done ? 'Already done' : 'Done'}\n\n${block(out.todo)}`,
  deleted: out => `# Deleted ${out.slug}`,
};

function ok(out, format) {
  return { content: [{ type: 'text', text: format(out) }] };
}

function fail(code, message) {
  return {
    content: [{ type: 'text', text: `# Error ${code}\n\n${message}` }],
    isError: true,
  };
}

function handle(format, fn) {
  return async args => {
    try {
      return ok(fn(args), format);
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
