import { spawn } from 'node:child_process';

const DEFAULT_MAX_OUTPUT_BYTES = 18 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_ERROR_BYTES = 64 * 1024;

/**
 * Execute a JSON-returning PostGIS SQL statement using psql stdin.
 *
 * The low-level runner has no SQL permission enforcement. Most BDP callers
 * perform read-only GIS queries; Step 43's LOCAL operator-only evidence-intake
 * CLI explicitly invokes a validated append-only INSERT. NEVER expose this
 * generic SQL runner to an unauthenticated remote/browser API.
 *
 * On Windows, putting large GeoJSON literals into execFile's --command
 * argument can exceed the command-line limit (spawn ENAMETOOLONG).
 * The SQL therefore travels over a pipe, never argv, the shell or a temp file.
 */
export function queryPostgisJsonStdin(sql, {
  service = process.env.BDP_PG_SERVICE,
  spawnImpl = spawn,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!/^[A-Za-z0-9_.-]+$/.test(String(service || ''))) {
    return Promise.reject(Object.assign(new Error('BDP PostGIS is not configured'), {
      code: 'BDP_POSTGIS_NOT_CONFIGURED',
    }));
  }
  if (typeof sql !== 'string' || !sql.trim()) {
    return Promise.reject(new Error('A nonempty SQL query is required'));
  }

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl('psql', [
        `service=${service}`,
        '-X',
        '-v', 'ON_ERROR_STOP=1',
        '--tuples-only', '--no-align',
        '--file', '-',
      ], {
        cwd: process.cwd(),
        env: process.env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }

    let output = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      const error = new Error('BDP PostGIS query timed out');
      error.code = 'BDP_POSTGIS_TIMEOUT';
      child.kill();
      finish(error);
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      stdoutBytes += data.length;
      if (stdoutBytes > maxOutputBytes) {
        const error = new Error('BDP PostGIS response exceeds maximum size');
        error.code = 'BDP_POSTGIS_OUTPUT_TOO_LARGE';
        child.kill();
        finish(error);
        return;
      }
      output += data.toString('utf8');
    });
    child.stderr.on('data', (data) => {
      stderrBytes += data.length;
      if (stderrBytes <= MAX_ERROR_BYTES) stderr += data.toString('utf8');
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        const error = new Error(`BDP PostGIS query failed (exit ${code ?? signal ?? 'unknown'})`);
        error.code = 'BDP_POSTGIS_QUERY_FAILED';
        error.stderr = stderr;
        finish(error);
        return;
      }
      try {
        const text = output.trim();
        finish(null, text ? JSON.parse(text) : null);
      } catch (error) {
        finish(error);
      }
    });
    child.stdin.on('error', (error) => {
      // EPIPE can follow a database-side failure; preserve the useful psql
      // stderr/exit result instead of converting it into a misleading pipe error.
      if (error.code !== 'EPIPE') finish(error);
    });
    child.stdin.end(sql, 'utf8');
  });
}
