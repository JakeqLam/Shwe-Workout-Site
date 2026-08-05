import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, statSync, createReadStream } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = resolve(__dirname, 'docs');
const DATA_DIR = resolve(__dirname, 'data');
const DB_PATH = resolve(process.env.DB_PATH || join(DATA_DIR, 'workouts.db'));
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 1_000_000;
const ALLOWED_ORIGINS = new Set(
  String(process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
);

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH, { timeout: 5_000 });
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS workouts (
    id TEXT PRIMARY KEY,
    saved_at TEXT NOT NULL,
    workout_date TEXT NOT NULL,
    session_type TEXT NOT NULL,
    pain_before REAL,
    pain_peak REAL,
    pain_after REAL,
    pain_next_morning REAL,
    sitting_minutes INTEGER,
    squat_target TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    completed_exercises TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_workouts_date
    ON workouts(workout_date DESC, saved_at DESC);
`);

const selectAll = db.prepare(`
  SELECT
    id,
    saved_at,
    workout_date,
    session_type,
    pain_before,
    pain_peak,
    pain_after,
    pain_next_morning,
    sitting_minutes,
    squat_target,
    notes,
    completed_exercises
  FROM workouts
  ORDER BY workout_date DESC, saved_at DESC
`);

const selectById = db.prepare(`
  SELECT
    id,
    saved_at,
    workout_date,
    session_type,
    pain_before,
    pain_peak,
    pain_after,
    pain_next_morning,
    sitting_minutes,
    squat_target,
    notes,
    completed_exercises
  FROM workouts
  WHERE id = ?
`);

const upsertWorkout = db.prepare(`
  INSERT INTO workouts (
    id,
    saved_at,
    workout_date,
    session_type,
    pain_before,
    pain_peak,
    pain_after,
    pain_next_morning,
    sitting_minutes,
    squat_target,
    notes,
    completed_exercises
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    saved_at = excluded.saved_at,
    workout_date = excluded.workout_date,
    session_type = excluded.session_type,
    pain_before = excluded.pain_before,
    pain_peak = excluded.pain_peak,
    pain_after = excluded.pain_after,
    pain_next_morning = excluded.pain_next_morning,
    sitting_minutes = excluded.sitting_minutes,
    squat_target = excluded.squat_target,
    notes = excluded.notes,
    completed_exercises = excluded.completed_exercises,
    updated_at = CURRENT_TIMESTAMP
`);

const deleteById = db.prepare('DELETE FROM workouts WHERE id = ?');
const deleteAll = db.prepare('DELETE FROM workouts');
const countAll = db.prepare('SELECT COUNT(*) AS count FROM workouts');

function isAllowedOrigin(req, origin) {
  if (!origin) return true;

  const host = req.headers.host;
  if (host && (origin === `http://${host}` || origin === `https://${host}`)) {
    return true;
  }

  return ALLOWED_ORIGINS.has(origin);
}

function setCommonHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');

  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(req, origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(text));
  res.end(text);
}

function apiError(res, status, message, details) {
  json(res, status, {
    error: message,
    ...(details ? { details } : {})
  });
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

function requiredText(value, field, maxLength = 200) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${field} is required.`);
  if (text.length > maxLength) throw new Error(`${field} is too long.`);
  return text;
}

function optionalText(value, field, maxLength) {
  const text = String(value ?? '').trim();
  if (text.length > maxLength) throw new Error(`${field} is too long.`);
  return text;
}

function optionalNumber(value, field, { min = -Infinity, max = Infinity, integer = false } = {}) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${field} must be a number.`);
  if (integer && !Number.isInteger(number)) throw new Error(`${field} must be a whole number.`);
  if (number < min || number > max) throw new Error(`${field} must be between ${min} and ${max}.`);
  return number;
}

function normalizeExercises(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > 100) throw new Error('Too many completed exercises were supplied.');

  return [...new Set(value.map(item => String(item).trim()).filter(Boolean))].map(item => {
    if (item.length > 100) throw new Error('An exercise identifier is too long.');
    return item;
  });
}

function normalizeWorkout(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Workout must be an object.');
  }

  const date = requiredText(input.date, 'Date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Date must use YYYY-MM-DD format.');
  }

  const savedAtCandidate = String(input.savedAt ?? '').trim();
  const savedAt = savedAtCandidate && !Number.isNaN(Date.parse(savedAtCandidate))
    ? new Date(savedAtCandidate).toISOString()
    : new Date().toISOString();

  return {
    id: optionalText(input.id || randomUUID(), 'ID', 100) || randomUUID(),
    savedAt,
    date,
    session: requiredText(input.session || 'Workout', 'Session', 100),
    before: optionalNumber(input.before, 'Pain before', { min: 0, max: 10 }),
    peak: optionalNumber(input.peak, 'Peak pain', { min: 0, max: 10 }),
    after: optionalNumber(input.after, 'Pain after', { min: 0, max: 10 }),
    morning: optionalNumber(input.morning, 'Next-morning pain', { min: 0, max: 10 }),
    sitting: optionalNumber(input.sitting, 'Comfortable sitting minutes', { min: 0, max: 100000, integer: true }),
    target: optionalText(input.target, 'Squat target', 300),
    notes: optionalText(input.notes, 'Notes', 10000),
    completedExercises: normalizeExercises(input.completedExercises)
  };
}

function rowToWorkout(row) {
  let completedExercises = [];
  try {
    const parsed = JSON.parse(row.completed_exercises || '[]');
    if (Array.isArray(parsed)) completedExercises = parsed;
  } catch {
    completedExercises = [];
  }

  const display = value => value === null || value === undefined ? '' : String(value);

  return {
    id: row.id,
    savedAt: row.saved_at,
    date: row.workout_date,
    session: row.session_type,
    before: display(row.pain_before),
    peak: display(row.pain_peak),
    after: display(row.pain_after),
    morning: display(row.pain_next_morning),
    sitting: display(row.sitting_minutes),
    target: row.squat_target || '',
    notes: row.notes || '',
    completedCount: `${completedExercises.length}/14`,
    completedExercises
  };
}

function writeWorkout(workout) {
  upsertWorkout.run(
    workout.id,
    workout.savedAt,
    workout.date,
    workout.session,
    workout.before,
    workout.peak,
    workout.after,
    workout.morning,
    workout.sitting,
    workout.target,
    workout.notes,
    JSON.stringify(workout.completedExercises)
  );

  return rowToWorkout(selectById.get(workout.id));
}

async function handleApi(req, res, pathname) {
  if (req.method === 'OPTIONS') {
    if (req.headers.origin && !isAllowedOrigin(req, req.headers.origin)) {
      return apiError(res, 403, 'This origin is not allowed to access the API.');
    }
    res.statusCode = 204;
    return res.end();
  }

  if (req.headers.origin && !isAllowedOrigin(req, req.headers.origin)) {
    return apiError(res, 403, 'This origin is not allowed to access the API.');
  }

  if (pathname === '/api/health' && req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      storage: 'sqlite',
      workouts: Number(countAll.get().count),
      database: DB_PATH,
      time: new Date().toISOString()
    });
  }

  if (pathname === '/api/workouts' && req.method === 'GET') {
    return json(res, 200, selectAll.all().map(rowToWorkout));
  }

  if (pathname === '/api/workouts' && req.method === 'POST') {
    try {
      const workout = normalizeWorkout(await readJsonBody(req));
      return json(res, 201, writeWorkout(workout));
    } catch (error) {
      return apiError(res, error.statusCode || 400, error.message);
    }
  }

  if (pathname === '/api/workouts' && req.method === 'DELETE') {
    const result = deleteAll.run();
    return json(res, 200, { deleted: Number(result.changes) });
  }

  if (pathname === '/api/workouts/import' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const workouts = Array.isArray(body) ? body : body.workouts;
      const mode = Array.isArray(body) ? 'merge' : String(body.mode || 'merge').toLowerCase();

      if (!Array.isArray(workouts)) {
        throw new Error('Import must contain a workouts array.');
      }
      if (workouts.length > 10000) {
        throw new Error('Import is limited to 10,000 workouts at a time.');
      }
      if (!['merge', 'replace'].includes(mode)) {
        throw new Error('Import mode must be merge or replace.');
      }

      const normalized = workouts.map(normalizeWorkout);
      db.exec('BEGIN IMMEDIATE');
      try {
        if (mode === 'replace') deleteAll.run();
        for (const workout of normalized) writeWorkout(workout);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }

      return json(res, 200, {
        imported: normalized.length,
        mode,
        workouts: selectAll.all().map(rowToWorkout)
      });
    } catch (error) {
      return apiError(res, error.statusCode || 400, error.message);
    }
  }

  const workoutMatch = pathname.match(/^\/api\/workouts\/([^/]+)$/);
  if (workoutMatch && req.method === 'DELETE') {
    let id;
    try {
      id = decodeURIComponent(workoutMatch[1]);
    } catch {
      return apiError(res, 400, 'Workout ID is invalid.');
    }
    const result = deleteById.run(id);
    if (!result.changes) return apiError(res, 404, 'Workout was not found.');
    res.statusCode = 204;
    return res.end();
  }

  return apiError(res, 404, 'API route not found.');
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

function serveStatic(req, res, pathname) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  } catch {
    res.statusCode = 400;
    return res.end('Bad request');
  }

  const normalizedPath = normalize(relativePath).replace(/^([/\\])+/, '');
  const filePath = resolve(DOCS_DIR, normalizedPath);
  if (filePath !== DOCS_DIR && !filePath.startsWith(`${DOCS_DIR}${sep}`)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Not found');
  }

  const type = MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
  const size = statSync(filePath).size;
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', size);
  res.setHeader('Cache-Control', type.startsWith('text/html') ? 'no-cache' : 'public, max-age=300');

  if (req.method === 'HEAD') return res.end();
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  setCommonHeaders(req, res);

  let url;
  try {
    url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  } catch {
    res.statusCode = 400;
    return res.end('Bad request');
  }

  try {
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url.pathname);
    }

    if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      return res.end('Method not allowed');
    }

    return serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) return apiError(res, 500, 'Unexpected server error.');
    res.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log("♡ Plu's Workout Tracker is running");
  console.log(`  App:      http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  Health:   http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/api/health`);
  console.log(`  Database: ${DB_PATH}`);
  if (HOST === '0.0.0.0') {
    console.log('  LAN mode is enabled. Use this computer\'s local IPv4 address from another device.');
  }
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});

function shutdown(signal) {
  console.log(`\n${signal} received. Closing the tracker...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
