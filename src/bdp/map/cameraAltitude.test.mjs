import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  FREE_BROWSE_HEIGHT_METERS,
  cameraHeightMeters, formatCameraHeight, freeBrowseLookPoint,
  frameFreeBrowse, mountCameraAltimeter,
} from './cameraAltitude.js';

function viewer(height, latitude = 30.2672, longitude = -97.7431) {
  const flights = [];
  let onChange;
  let unsubscribed = false;
  const v = {
    scene: { canvas: { clientWidth: 1200, clientHeight: 900 }, globe: { ellipsoid: Cesium.Ellipsoid.WGS84 } },
    camera: {
      heading: 0, pitch: -1.2,
      positionCartographic: Cesium.Cartographic.fromDegrees(longitude, latitude, height),
      changed: { addEventListener(fn) { onChange = fn; return () => { unsubscribed = true; }; } },
      flyTo(options) { flights.push(options); },
    },
  };
  return { v, flights, change: () => onChange?.(), get unsubscribed() { return unsubscribed; } };
}

test('free browse uses a medium district camera height, not rooftop or whole-county altitude', () => {
  const close = viewer(800);
  assert.equal(frameFreeBrowse(close.v), true);
  const dest = Cesium.Cartographic.fromCartesian(close.flights[0].destination);
  assert.ok(Math.abs(dest.height - FREE_BROWSE_HEIGHT_METERS) < 1);
  assert.ok(Math.abs(Cesium.Math.toDegrees(dest.latitude) - 30.2672) < 0.01);
  const broad = viewer(130000);
  assert.equal(frameFreeBrowse(broad.v), true);
  assert.equal(broad.flights.length, 1);
  const justRight = viewer(16000);
  assert.equal(frameFreeBrowse(justRight.v), false);
  assert.equal(justRight.flights.length, 0);
});

test('camera framing tracks viewed ground even when tilted camera position is offset', () => {
  const obj = viewer(80000, 29.0, -97.7);
  const target = Cesium.Cartographic.fromDegrees(-97.75, 30.25);
  obj.v.camera.pickEllipsoid = () => Cesium.Cartesian3.fromRadians(target.longitude, target.latitude);
  const look = freeBrowseLookPoint(obj.v);
  assert.ok(Math.abs(look.latitude - 30.25) < 0.001);
  frameFreeBrowse(obj.v);
  const dest = Cesium.Cartographic.fromCartesian(obj.flights[0].destination);
  assert.ok(Math.abs(Cesium.Math.toDegrees(dest.latitude) - 30.25) < 0.001);
});

test('altimeter shows camera height above WGS84 ellipsoid and unsubscribes on cleanup', () => {
  const oldDocument = globalThis.document;
  const root = { children: [], append(el) { this.children.push(el); } };
  globalThis.document = {
    body: root,
    createElement: (tag) => ({
      tagName: tag, children: [], textContent: '', attrs: {},
      setAttribute(k,v) { this.attrs[k] = v; },
      append(...els) { this.children.push(...els); },
      remove() { this.removed = true; },
    }),
  };
  try {
    const v = viewer(14000);
    const alt = mountCameraAltimeter(v.v);
    const element = root.children[0];
    assert.equal(element.id, 'land-camera-altimeter');
    assert.match(element.title, /WGS84 ellipsoid/);
    assert.equal(element.children[1].textContent, '14.0 km');
    v.v.camera.positionCartographic.height = 750;
    v.change();
    assert.equal(element.children[1].textContent, '750 m');
    alt.destroy();
    assert.equal(v.unsubscribed, true);
    assert.equal(element.removed, true);
  } finally {
    globalThis.document = oldDocument;
  }
});

test('invalid camera heights cannot become fabricated altitude readings', () => {
  assert.equal(formatCameraHeight(null), 'Height unavailable');
  assert.equal(formatCameraHeight(-1), 'Height unavailable');
  assert.equal(cameraHeightMeters(null), null);
});
