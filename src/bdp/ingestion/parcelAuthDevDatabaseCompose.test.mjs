import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(
  new URL('../../../docker-compose.auth-dev.yml',import.meta.url),'utf8',
);
const body=source.split('\n').filter(line=>!line.trimStart().startsWith('#')).join('\n');

test('62D-A uses its own explicit Docker Compose project name',()=>{
  assert.match(body,/^name: ldos-auth-dev$/m);
});
test('62D-A has exactly one Docker service and never mounts parcel services',()=>{
  assert.match(body,/^services:\n  auth-postgres:/m);
  assert.equal((body.match(/^  [a-z][a-z-]+:\s*$/gm)||[]).length,1);
  assert.doesNotMatch(body,/bdp-postgis|parcel-postgis|gis-redis/);
});
test('62D-A uses the PostgreSQL 17 image, not PostGIS or Supabase',()=>{
  assert.match(body,/^    image: postgres:17$/m);
  assert.doesNotMatch(body,/postgis\/postgis|supabase|auth\.users/);
});
test('62D-A requires an external owner password with no sample or default',()=>{
  assert.match(body,/POSTGRES_PASSWORD: \$\{LDOS_AUTH_DEV_POSTGRES_PASSWORD:\?/);
  assert.doesNotMatch(body,/POSTGRES_PASSWORD: (?:postgres|password|changeme|1234)/);
});
test('62D-A initializes unique app auth dev database',()=>{
  assert.match(body,/POSTGRES_DB: ldos_auth_dev/);
  assert.match(body,/POSTGRES_USER: postgres/);
  assert.doesNotMatch(body,/POSTGRES_DB: bdp\b/);
});
test('62D-A enables SCRAM on newly initialized PostgreSQL data',()=>{
  assert.match(body,/POSTGRES_INITDB_ARGS: "--auth-host=scram-sha-256"/);
});
test('62D-A maps exactly one TCP port, literally loopback only',()=>{
  assert.match(body,/"127\.0\.0\.1:54338:5432"/);
  assert.equal((body.match(/^      - "[^"]+:5432"$/gm)||[]).length,1);
  assert.doesNotMatch(body,/0\.0\.0\.0:|:54329:5432/);
});
test('62D-A port binding cannot be changed to non-local via env substitution',()=>{
  assert.doesNotMatch(body,/LDOS_AUTH_DEV_DB_PORT|\$\{.*BIND|network_mode:/);
});
test('62D-A persists to a distinct named data volume',()=>{
  assert.match(body,/ldos_auth_dev_pgdata:\/var\/lib\/postgresql\/data/);
  assert.match(body,/^volumes:\n  ldos_auth_dev_pgdata:/m);
  assert.doesNotMatch(body,/bdp_postgis_data/);
});
test('62D-A has no host bind mounts, Docker socket, or checked-in credential files',()=>{
  assert.doesNotMatch(body,/\.\/|\.env|\/var\/run\/docker\.sock|\$HOME|C:\\\\/);
});
test('62D-A never automatically applies staged SQL, seed users or migrations',()=>{
  assert.doesNotMatch(body,/docker-entrypoint-initdb\.d|migration|seed|init\.sql|command:/i);
});
test('62D-A never runs a publicly accessible app server, edge route or geometry API',()=>{
  assert.doesNotMatch(body,/8787|3000|8080|5173|public:|proxy:|http:|geometry/);
});
test('62D-A adds a readiness healthcheck without printing the password',()=>{
  assert.match(body,/pg_isready -U postgres -d ldos_auth_dev/);
  assert.match(body,/^    healthcheck:$/m);
  assert.doesNotMatch(body,/healthcheck:[\s\S]*PGPASSWORD/);
});
test('62D-A is opt-in, not an auto-started production-like service',()=>{
  assert.match(body,/restart: "no"/);
  assert.doesNotMatch(body,/restart: (?:always|unless-stopped)|privileged: true/);
});
test('62D-A does not enable network-host or untrusted external volumes',()=>{
  assert.doesNotMatch(body,/network_mode: host|external: true|cap_add:|volumes_from:/);
});
test('62D-A does not grant application roles, county permissions or issue sessions',()=>{
  assert.doesNotMatch(body,/CREATE ROLE|GRANT |ldos_app_auth|county_grants|sessions\(/);
});
