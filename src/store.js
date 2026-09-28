import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { log } from './log.js';
import { localISO } from './dates.js';

const DATA_DIR = process.env.TODO_DATA_DIR || path.join(os.homedir(), '.claude-todo');
const DB_FILE = path.join(DATA_DIR, 'todo.db');

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS todos (
    slug        TEXT PRIMARY KEY,
    prompt      TEXT NOT NULL,
    importance  TEXT NOT NULL DEFAULT 'medium' CHECK (importance IN ('low', 'medium', 'high')),
    date        TEXT,
    due_ts      INTEGER,
    created_at  TEXT NOT NULL,
    done_at     TEXT
  );

  CREATE INDEX IF NOT EXISTS todos_open_due ON todos (done_at, due_ts);
`);

log('store', `using ${DB_FILE}`);

const COLUMNS = 'slug, prompt, importance, date, created_at, done_at';
const IMPORTANCE_RANK = `CASE importance WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END`;

export class TodoError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function toTodo(row) {
  return {
    slug: row.slug,
    prompt: row.prompt,
    importance: row.importance,
    date: row.date,
    status: row.done_at ? 'done' : 'open',
    created_at: row.created_at,
    done_at: row.done_at,
  };
}

function statusClause(status) {
  if (status === 'open') return 'done_at IS NULL';
  if (status === 'done') return 'done_at IS NOT NULL';
  return null;
}

function orderClause(order) {
  const dir = order === 'desc' ? 'DESC' : 'ASC';
  return `ORDER BY due_ts IS NULL, due_ts ${dir}, ${IMPORTANCE_RANK} DESC, created_at ASC`;
}

function select(where, params, order, limit) {
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { total, open } = db
    .prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(done_at IS NULL), 0) AS open FROM todos ${whereSql}`)
    .get(...params);
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM todos ${whereSql} ${orderClause(order)} LIMIT ?`)
    .all(...params, limit);
  const todos = rows.map(toTodo);
  return { todos, count: todos.length, total, open };
}

function getRow(slug) {
  return db.prepare(`SELECT ${COLUMNS} FROM todos WHERE slug = ?`).get(slug);
}

export function addTodo({ slug, prompt, importance, date }) {
  const existing = getRow(slug);
  if (existing && !existing.done_at) {
    throw new TodoError('SLUG_EXISTS', `An open todo with slug "${slug}" already exists`);
  }

  // A done todo's slug is free for reuse; the new todo replaces it.
  db.prepare(`
    INSERT OR REPLACE INTO todos (slug, prompt, importance, date, due_ts, created_at, done_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
  `).run(slug, prompt, importance, date?.date ?? null, date?.ts ?? null, localISO(new Date()));

  log('store', `added ${slug}`);
  return toTodo(getRow(slug));
}

export function updateTodo(slug, { prompt, importance, date }) {
  const sets = [];
  const params = [];
  if (prompt !== undefined) {
    sets.push('prompt = ?');
    params.push(prompt);
  }
  if (importance !== undefined) {
    sets.push('importance = ?');
    params.push(importance);
  }
  if (date !== undefined) {
    // date === null clears the due date.
    sets.push('date = ?', 'due_ts = ?');
    params.push(date?.date ?? null, date?.ts ?? null);
  }

  const { changes } = db.prepare(`UPDATE todos SET ${sets.join(', ')} WHERE slug = ?`).run(...params, slug);
  if (!changes) throw new TodoError('NOT_FOUND', `No todo with slug "${slug}"`);

  log('store', `updated ${slug}`);
  return toTodo(getRow(slug));
}

export function listTodos({ status, importance, before, order, limit }) {
  const where = [];
  const params = [];
  const s = statusClause(status);
  if (s) where.push(s);
  if (importance) {
    where.push('importance = ?');
    params.push(importance);
  }
  if (before != null) {
    where.push('due_ts IS NOT NULL AND due_ts < ?');
    params.push(before);
  }
  return select(where, params, order, limit);
}

export function searchTodos({ query, status, limit }) {
  const pattern = `%${query.replace(/[\\%_]/g, c => `\\${c}`)}%`;
  const where = [`(slug LIKE ? ESCAPE '\\' OR prompt LIKE ? ESCAPE '\\')`];
  const params = [pattern, pattern];
  const s = statusClause(status);
  if (s) where.push(s);
  return select(where, params, 'asc', limit);
}

export function markDone(slug) {
  const row = getRow(slug);
  if (!row) throw new TodoError('NOT_FOUND', `No todo with slug "${slug}"`);
  if (row.done_at) return { todo: toTodo(row), already_done: true };

  db.prepare('UPDATE todos SET done_at = ? WHERE slug = ?').run(localISO(new Date()), slug);
  log('store', `done ${slug}`);
  return { todo: toTodo(getRow(slug)), already_done: false };
}

export function deleteTodo(slug) {
  const { changes } = db.prepare('DELETE FROM todos WHERE slug = ?').run(slug);
  if (!changes) throw new TodoError('NOT_FOUND', `No todo with slug "${slug}"`);
  log('store', `deleted ${slug}`);
  return { slug, deleted: true };
}
