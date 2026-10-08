import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildNormalizeSql, buildMswAlreadyImportedSql } from './tceq-msw-import.mjs';

let historicalStage = 'msw_historical_stage';
if (process.env.BDP_VALIDATE_GDAL === '1') {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'bdp-msw-gdal-'));
  try {
    const csv = path.join(directory, 'historical.csv');
    const workbook = path.join(directory, 'historical.xlsx');
    writeFileSync(csv, [
      'field1,field2,field3,field4,field5,field6,field7',
      'Historical inventory notice,,,,,,',
      'UNUM,SITE_NAME1,LATIT_DD,LONGI_DD,UNAUTHOR,HAZ_CERT,DATE_CLOSE',
      '42,Historical fixture,29.405,-98.495,Y,Y,02/30/1990',
      '',
    ].join('\n'));
    execFileSync('ogr2ogr', ['-f', 'XLSX', workbook, csv], { stdio: 'inherit' });
    historicalStage = 'msw_historical_gdal_fixture';
    execFileSync('ogr2ogr', [
      '-f', 'PostgreSQL', `PG:dbname=${process.env.PGDATABASE || 'bdp'}`,
      workbook, '-nln', historicalStage, '-overwrite', '-lco', 'LAUNDER=YES',
      '--config', 'OGR_XLSX_HEADERS', 'DISABLE',
      '--config', 'OGR_XLSX_FIELD_TYPES', 'STRING',
    ], { stdio: 'inherit' });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

// Uses the same PG* environment as BDP Validation; all fixture writes roll back.
const manifest = { filename: 'fixture.xls', url: 'https://example.test/fixture', checksumSha256: 'a'.repeat(64), checkedAt: new Date().toISOString() };
const normalize = buildNormalizeSql({ dataset: 'facilities', table: 'msw_validation_stage', manifest }).replace('BEGIN;', '').replace('COMMIT;', '');
const previousChecksumQuery = buildMswAlreadyImportedSql({ dataset: 'facilities', checksumSha256: 'a'.repeat(64) });
const latestChecksumQuery = buildMswAlreadyImportedSql({ dataset: 'facilities', checksumSha256: 'b'.repeat(64) });
const historicalNormalize = buildNormalizeSql({ dataset: 'unnumbered', table: historicalStage, manifest: { ...manifest, filename: 'fixture.xlsx' } }).replace('BEGIN;', '').replace('COMMIT;', '');
const historicalFixture = historicalStage === 'msw_historical_stage' ? `
CREATE TEMP TABLE msw_historical_stage(ogc_fid integer, field1 text, field2 text, field3 text, field4 text, field5 text, field6 text, field7 text);
INSERT INTO msw_historical_stage VALUES
 (1,'Historical inventory notice',NULL,NULL,NULL,NULL,NULL,NULL),
 (2,'UNUM','SITE_NAME1','LATIT_DD','LONGI_DD','UNAUTHOR','HAZ_CERT','DATE_CLOSE'),
 (3,'42','Historical fixture','29.405','-98.495','Y','Y','02/30/1990');
` : '';
const sql = `
BEGIN;
TRUNCATE bdp_tceq_msw_sites, bdp_ingestion_runs;
DO $$ BEGIN
  IF (bdp_tceq_msw_coverage()->>'complete')::boolean THEN
    RAISE EXCEPTION 'Empty database cannot provide MSW coverage'; END IF;
END $$;
CREATE TEMP TABLE msw_validation_stage(site_name text, physical_type text, physical_site_status text, latitude text, longitude text);
INSERT INTO msw_validation_stage VALUES
 ('Fixture landfill','1AE','Active','29.405','-98.495'),
 ('Fixture transfer','5CC','Active','29.405','-98.495'),
 ('Fixture construction','CP','Active','29.405','-98.495'),
 ('Fixture mixed landfill','1 AE & 4 AE','Active','29.405','-98.495'),
 ('Fixture monofill','MONOFILL','Active','29.405','-98.495');
${normalize}
INSERT INTO bdp_tceq_msw_sites(source_dataset,source_filename,source_url,site_name,physical_status,geom,unauthorized,hazardous_waste_confirmed)
VALUES
 ('closed','fixture','fixture','Closed fixture','Closed',ST_SetSRID(ST_Point(-98.495,29.405),4326),NULL,NULL),
 ('revoked','fixture','fixture','Revoked fixture','Not Constructed',ST_SetSRID(ST_Point(-98.495,29.405),4326),NULL,NULL),
 ('unnumbered','fixture','fixture','Temporary history','Historical',ST_SetSRID(ST_Point(-98.495,29.405),4326),true,true);
${historicalFixture}
${historicalNormalize}
DO $$ DECLARE m record; BEGIN
 IF EXISTS (SELECT 1 FROM bdp_tceq_msw_sites WHERE source_dataset = 'unnumbered' AND date_closed IS NOT NULL) THEN
   RAISE EXCEPTION 'Invalid historical date must remain unknown'; END IF;
 SELECT * INTO m FROM bdp_tceq_parcel_msw_metrics(ST_GeomFromText('POLYGON((-98.5 29.4,-98.49 29.4,-98.49 29.41,-98.5 29.41,-98.5 29.4))',4326));
 IF m.msw_points_on_parcel <> 8 OR m.active_landfills_within_1_mi <> 3
   OR m.closed_sites_within_1_mi <> 1 OR m.unauthorized_sites_within_1_mi <> 1
   OR m.hazardous_history_sites_within_3_mi <> 1 OR m.nearest_msw_site_m <> 0 THEN
   RAISE EXCEPTION 'MSW populated parcel metrics mismatch: %', row_to_json(m); END IF;
 IF (bdp_tceq_msw_coverage()->>'complete')::boolean THEN
   RAISE EXCEPTION 'Missing snapshot manifests cannot provide coverage'; END IF;
END $$;
INSERT INTO bdp_ingestion_runs(source_id,dataset,status,completed_at,row_count,checksum_sha256)
 SELECT 'tceq-msw',source_dataset,'succeeded',NOW(),COUNT(*),repeat('a',64)
 FROM bdp_tceq_msw_sites WHERE source_dataset <> 'facilities' GROUP BY source_dataset;
DO $$ BEGIN
 IF NOT (bdp_tceq_msw_coverage()->>'complete')::boolean THEN
   RAISE EXCEPTION 'Fresh full fixtures should provide coverage'; END IF;
END $$;
INSERT INTO bdp_ingestion_runs(source_id,dataset,status,completed_at,row_count,checksum_sha256)
VALUES ('tceq-msw','facilities','succeeded',NOW() + INTERVAL '1 second',5,repeat('b',64));
DO $$ BEGIN
 IF (${previousChecksumQuery}) THEN
   RAISE EXCEPTION 'A-B-A checksum recurrence must reimport, not skip historical snapshot'; END IF;
 IF NOT (${latestChecksumQuery}) THEN
   RAISE EXCEPTION 'Latest checksum should skip unchanged snapshot'; END IF;
END $$;
UPDATE bdp_ingestion_runs SET completed_at = NOW() WHERE dataset = 'facilities';
UPDATE bdp_ingestion_runs SET completed_at = NOW() - INTERVAL '15 days' WHERE dataset = 'closed';
DO $$ BEGIN
 IF (bdp_tceq_msw_coverage()->>'complete')::boolean THEN
   RAISE EXCEPTION 'Stale weekly import cannot provide coverage'; END IF;
END $$;
UPDATE bdp_ingestion_runs SET completed_at = NOW();
UPDATE bdp_tceq_msw_sites SET geom = NULL WHERE source_dataset = 'unnumbered';
DO $$ BEGIN
 IF (bdp_tceq_msw_coverage()->>'complete')::boolean THEN
   RAISE EXCEPTION 'Unlocated historical records cannot provide full coverage'; END IF;
END $$;
ROLLBACK;
`;
try {
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1'], { input: sql, stdio: ['pipe', 'inherit', 'inherit'] });
} finally {
  if (historicalStage !== 'msw_historical_stage') {
    execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '--command', `DROP TABLE IF EXISTS ${historicalStage}`], { stdio: 'inherit' });
  }
}
console.log('[BDP:MSW] Populated spatial, importer and coverage assertions passed');
