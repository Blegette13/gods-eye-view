import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import test from 'node:test';
import { queryPostgisJsonStdin } from './bdp-psql.js';

function fakePsql({ stdout = '{"ok":true}', stderr = '', exitCode = 0, onSpawn = () => {} } = {}) {
  return (command, args, options) => {
    const child = new EventEmitter();
    let receivedSql = '';
    child.stdin = new Writable({
      write(chunk, _encoding, done) {
        receivedSql += chunk.toString('utf8');
        done();
      },
    });
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    onSpawn(command, args, options);
    child.stdin.on('finish', () => {
      queueMicrotask(() => {
        if (stdout) child.stdout.emit('data', Buffer.from(stdout));
        if (stderr) child.stderr.emit('data', Buffer.from(stderr));
        child.emit('close', exitCode);
        onSpawn.receivedSql = receivedSql;
      });
    });
    return child;
  };
}

test('streams very large GeoJSON SQL through stdin, not process arguments', async () => {
  const sql = "SELECT '" + 'x'.repeat(125_000) + "'::text";
  const check = (_, args, options) => {
    assert.equal(args[0], 'service=bdp');
    assert.deepEqual(args.slice(-2), ['--file', '-']);
    assert.equal(options.stdio[0], 'pipe');
    assert.equal(args.some((arg) => arg.includes('xxx')), false);
  };
  const result = await queryPostgisJsonStdin(sql, {
    service: 'bdp', spawnImpl: fakePsql({ onSpawn: check }),
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(check.receivedSql, sql);
});

test('failed psql retains stderr for missing PUCT function detection', async () => {
  const stderr = 'ERROR: function bdp_puct_water_ccn_metrics(geometry) does not exist';
  await assert.rejects(
    queryPostgisJsonStdin('SELECT missing()', {
      service: 'bdp', spawnImpl: fakePsql({ stderr, exitCode: 3, stdout: '' }),
    }),
    (error) => error.code === 'BDP_POSTGIS_QUERY_FAILED' && error.stderr === stderr,
  );
});

test('unconfigured PostGIS does not spawn a process or run any SQL', async () => {
  await assert.rejects(
    queryPostgisJsonStdin('SELECT 1', { service: '' }),
    (error) => error.code === 'BDP_POSTGIS_NOT_CONFIGURED',
  );
});
