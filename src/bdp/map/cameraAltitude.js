import * as Cesium from 'cesium';

// WGS84 ellipsoid heights are NOT above ground level or aircraft data.
export const FREE_BROWSE_HEIGHT_METERS = 14000;
export const FREE_BROWSE_MIN_METERS = 10500;
export const FREE_BROWSE_MAX_METERS = 26000;
const DEFAULT_TEXAS_PILOT_CENTER = Object.freeze({ latitude: 30.2672, longitude: -97.7431 });

export function cameraHeightMeters(viewer) {
  const height = viewer?.camera?.positionCartographic?.height;
  return Number.isFinite(height) && height >= 0 ? height : null;
}

export function formatCameraHeight(meters) {
  if (!Number.isFinite(meters) || meters < 0) return 'Height unavailable';
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

function validTexasView(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= 25 && latitude <= 37 && longitude >= -107 && longitude <= -93;
}

export function freeBrowseLookPoint(viewer) {
  const camera = viewer?.camera;
  if (!camera) return DEFAULT_TEXAS_PILOT_CENTER;
  // The camera can be tens of miles south of what the customer is looking
  // at when tilted. Prefer the globe point at screen center; only use the
  // camera's geographic position when a center pick is unavailable.
  const canvas = viewer.scene?.canvas;
  let look = null;
  if (canvas && camera.pickEllipsoid && Cesium.Cartographic?.fromCartesian) {
    const x = (canvas.clientWidth || canvas.width || 0) / 2;
    const y = (canvas.clientHeight || canvas.height || 0) / 2;
    const ground = camera.pickEllipsoid(
      new Cesium.Cartesian2(x, y), viewer.scene?.globe?.ellipsoid,
    );
    if (ground) look = Cesium.Cartographic.fromCartesian(ground);
  }
  const p = look || camera.positionCartographic;
  const lat = Cesium.Math.toDegrees(p?.latitude ?? Number.NaN);
  const lon = Cesium.Math.toDegrees(p?.longitude ?? Number.NaN);
  return validTexasView(lat, lon)
    ? Object.freeze({ latitude: lat, longitude: lon }) : DEFAULT_TEXAS_PILOT_CENTER;
}

/** Free browsing is a district-scale view, independent of any search profile. */
export function frameFreeBrowse(viewer, { duration = 1.3 } = {}) {
  const camera = viewer?.camera;
  if (!camera?.flyTo || !Cesium?.Cartesian3?.fromDegrees) return false;
  const center = freeBrowseLookPoint(viewer);
  const lat = center.latitude;
  const lon = center.longitude;
  const height = cameraHeightMeters(viewer);
  const raw = camera.positionCartographic;
  const rawLat = Cesium.Math.toDegrees(raw?.latitude ?? Number.NaN);
  const rawLon = Cesium.Math.toDegrees(raw?.longitude ?? Number.NaN);
  if (height !== null && height >= FREE_BROWSE_MIN_METERS
      && height <= FREE_BROWSE_MAX_METERS
      && validTexasView(lat, lon) && validTexasView(rawLat, rawLon)) return false;
  camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(center.longitude, center.latitude, FREE_BROWSE_HEIGHT_METERS),
    orientation: {
      heading: Number.isFinite(camera.heading) ? camera.heading : 0,
      pitch: -Cesium.Math.toRadians(70),
      roll: 0,
    },
    duration,
  });
  return true;
}

/** Live Cesium camera-height display. Height is above ellipsoid, never AGL. */
export function mountCameraAltimeter(viewer) {
  const badge = document.createElement('output');
  badge.id = 'land-camera-altimeter';
  badge.setAttribute('aria-label', 'Camera height above WGS84 ellipsoid');
  badge.title = 'Approximate camera height above WGS84 ellipsoid; NOT height above terrain, sea level, or parcel elevation.';
  const heading = document.createElement('span');
  heading.textContent = 'CAMERA HEIGHT';
  const value = document.createElement('strong');
  value.textContent = '—';
  badge.append(heading, value);
  document.body.append(badge);
  let lastHeight = null;
  function refresh() {
    const height = cameraHeightMeters(viewer);
    if (height === lastHeight) return;
    lastHeight = height;
    value.textContent = formatCameraHeight(height);
  }
  refresh();
  const remove = viewer?.camera?.changed?.addEventListener?.(refresh) ?? null;
  const removeAfterFlight = viewer?.camera?.moveEnd?.addEventListener?.(refresh) ?? null;
  return Object.freeze({
    refresh,
    destroy() {
      if (typeof remove === 'function') remove();
      if (typeof removeAfterFlight === 'function') removeAfterFlight();
      badge.remove();
    },
  });
}
