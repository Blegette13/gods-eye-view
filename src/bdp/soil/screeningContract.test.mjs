import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSsurgoParcelRequest,
  buildSsurgoParcelSql,
  parseSdaColumnNameRows,
  soilGeometryToWkt,
  summarizeSsurgoRows,
} from './screeningContract.js';

const parcel = {
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-98.50, 29.40],
      [-98.49, 29.40],
      [-98.49, 29.41],
      [-98.50, 29.41],
      [-98.50, 29.40],
    ]],
  },
};

test('converts validated parcel polygon to WKT', () => {
  assert.equal(
    soilGeometryToWkt(parcel),
    'POLYGON((-98.5 29.4,-98.49 29.4,-98.49 29.41,-98.5 29.41,-98.5 29.4))',
  );
});

test('builds official SDA clipped-mapunit acreage query', () => {
  const sql = buildSsurgoParcelSql(parcel);
  assert.match(sql, /DeclareGeometry/);
  assert.match(sql, /GetClippedMapunits/);
  assert.match(sql, /GetGeogFromGeomWgs84/);
  assert.match(sql, /M\.muname/);
  assert.match(sql, /M\.farmlndcl/);
  assert.match(sql, /4046\.8564224/);

  const request = buildSsurgoParcelRequest(parcel);
  const body = new URLSearchParams(request.init.body);
  assert.equal(body.get('FORMAT'), 'JSON+COLUMNNAME');
  assert.match(body.get('QUERY'), /POLYGON/);
});

test('parses SDA column-name JSON and summarizes dominant mapunit', () => {
  const rows = parseSdaColumnNameRows({
    Table: [
      ['mukey', 'musym', 'muname', 'areasymbol', 'farmlndcl', 'area_m2', 'acres'],
      ['1', 'Aa', 'Alpha soil', 'TX001', 'Prime farmland', '40468.564224', '10'],
      ['2', 'Bb', 'Beta soil', 'TX001', 'Farmland of statewide importance', '20234.282112', '5'],
    ],
  });
  const summary = summarizeSsurgoRows(rows);
  assert.equal(summary.mapunitCount, 2);
  assert.equal(summary.mappedAcres, 15);
  assert.equal(summary.dominant.name, 'Alpha soil');
  assert.equal(Math.round(summary.dominant.mappedSharePercent), 67);
});
