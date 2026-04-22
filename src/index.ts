/**
 * DMR → APRS bridge
 *
 * Usage:
 *   dsdplus.exe -i 0 | npm start
 *
 * Pipeline:
 *   DSD+ stdout → parse DMR-ID + GPS → RadioID.net lookup → APRS backend POST /api/gps
 *
 * Position resolution (in order):
 *   1. GPS transmitted with the DMR call (from HD1 data channel, decoded by DSD+)
 *   2. DEFAULT_LAT / DEFAULT_LON from .env (e.g. repeater location)
 */
import { config } from './config';
import { startDsdReader, DmrEvent } from './dsd-reader';
import { lookupDmrId } from './radioid';
import { postPosition } from './aprs-client';
import { stats, addRecent } from './stats';
import { startHealthServer } from './health-server';

// Debounce: track last event time per DMR-ID
const lastSeen = new Map<number, number>();

async function handleEvent(event: DmrEvent): Promise<void> {
  stats.dmrEventsTotal++;
  if (event.lat !== undefined) stats.dmrEventsWithGps++;
  else stats.dmrEventsNoGps++;

  const now = Date.now();
  const last = lastSeen.get(event.dmrId) ?? 0;

  if (now - last < config.debounceSec * 1000) {
    stats.debounced++;
    return;
  }
  lastSeen.set(event.dmrId, now);

  console.log(`[dmr] Heard DMR-ID: ${event.dmrId}${event.lat !== undefined ? ` @ ${event.lat.toFixed(5)}, ${event.lon!.toFixed(5)}` : ' (no GPS)'}`);

  // 1. Resolve callsign
  const radio = await lookupDmrId(event.dmrId);
  if (!radio) {
    stats.lookupFail++;
    addRecent({ dmrId: event.dmrId, callsign: null, lat: event.lat, lon: event.lon, posted: false, reason: 'lookup failed', at: new Date().toISOString() });
    return;
  }
  stats.lookupSuccess++;

  // 2. Require GPS transmitted with the call — skip if missing
  if (event.lat === undefined || event.lon === undefined) {
    console.log(`[dmr] ${radio.callsign} (${event.dmrId}) — no GPS, skipping`);
    addRecent({ dmrId: event.dmrId, callsign: radio.callsign, posted: false, reason: 'no GPS', at: new Date().toISOString() });
    return;
  }

  const lat = event.lat;
  const lon = event.lon;
  const posSource = 'DMR GPS';

  console.log(`[dmr] Position: ${posSource} (${lat.toFixed(5)}, ${lon.toFixed(5)})`);

  // 3. Post to APRS backend
  stats.postsAttempted++;
  const ok = await postPosition({
    radioId:   radio.callsign,
    callsign:  radio.callsign,
    lat,
    lon,
    symbol:    '[',
    comment:   `DMR-ID: ${event.dmrId} | ${radio.name} | via DMR`,
    timestamp: new Date().toISOString(),
  });

  if (ok) stats.postsSuccess++;
  else stats.postsFailed++;

  addRecent({ dmrId: event.dmrId, callsign: radio.callsign, lat, lon, posted: ok, reason: ok ? undefined : 'POST failed', at: new Date().toISOString() });
}

console.log('[dmr-parser] Started — waiting for DSD+ input on stdin');
console.log(`[dmr-parser] Backend: ${config.backendUrl}`);
console.log(`[dmr-parser] Debounce: ${config.debounceSec}s`);
console.log('');

startHealthServer();

startDsdReader((event) => {
  handleEvent(event).catch(err => console.error('[dmr] Error:', err));
});
