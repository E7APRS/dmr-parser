/**
 * Reads DSD+ output line by line from stdin OR by tailing a log file.
 * Extracts DMR source IDs and GPS coordinates transmitted in the DMR data channel.
 *
 * Modes:
 *   1. Stdin pipe:   dsdplus.exe -i 0 | npm start
 *   2. File watch:   DSD_LOG_FILE=C:\path\to\VC.log npm start
 *      (DSD+ writes to the log file, parser tails it in real time)
 *
 * DSD+ source-ID patterns:
 *   Slot1: *VoiceHeader* ... Src: 2181234 Dst: 91 [Group]
 *   Voice Header: SrcID: 2181234 DstID: 91
 *   [Slot 1] [CC 1] SRC: 2181234
 *
 * DSD+ GPS patterns:
 *   GPS: Lat: 43.85630 Lon: 18.41310
 *   [Slot 1] GPS Pos: 43.85630N 18.41310E
 *   GPS: 43.85630N 018.41310E
 */
import * as readline from 'readline';
import * as fs from 'fs';
import { config } from './config';
import { stats } from './stats';

const SRC_PATTERNS = [
  /\bSrc:\s*(\d{4,9})\b/i,
  /\bSrcID:\s*(\d{4,9})\b/i,
  /\bSRC:\s*(\d{4,9})\b/i,
];

// Matches: "Lat: 43.85630 Lon: 18.41310" with optional N/S/E/W
const GPS_PATTERNS = [
  /Lat[:\s]+(-?\d+\.\d+)\s*[NS]?\s+Lon[:\s]+(-?\d+\.\d+)\s*[EW]?/i,
  /GPS\s+Pos[:\s]+(-?\d+\.\d+)[NS]\s+(-?\d+\.\d+)[EW]/i,
  /GPS[:\s]+(-?\d+\.\d+)[NS]\s+0*(-?\d+\.\d+)[EW]/i,
];

export interface DmrEvent {
  dmrId: number;
  lat?:  number;
  lon?:  number;
}

function createLineProcessor(onEvent: (event: DmrEvent) => void) {
  let pendingId:  number | null = null;
  let pendingLat: number | null = null;
  let pendingLon: number | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function flush(): void {
    if (pendingId === null) return;
    onEvent({ dmrId: pendingId, lat: pendingLat ?? undefined, lon: pendingLon ?? undefined });
    pendingId  = null;
    pendingLat = null;
    pendingLon = null;
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  }

  function scheduleFlush(): void {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 500);
  }

  return {
    processLine(line: string): void {
      stats.linesRead++;
      if (config.debug) console.log('[dsd]', line);

      for (const pattern of GPS_PATTERNS) {
        const m = line.match(pattern);
        if (m) {
          const lat = parseFloat(m[1]);
          const lon = parseFloat(m[2]);
          if (!isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
            if (config.debug) console.log(`[dsd] GPS parsed: ${lat}, ${lon}`);
            if (pendingId !== null) {
              pendingLat = lat;
              pendingLon = lon;
              flush();
            }
          }
          return;
        }
      }

      for (const pattern of SRC_PATTERNS) {
        const m = line.match(pattern);
        if (m) {
          const id = parseInt(m[1], 10);
          if (id >= 1 && id <= 16776415) {
            if (pendingId !== null) flush();
            pendingId  = id;
            pendingLat = null;
            pendingLon = null;
            scheduleFlush();
          }
          break;
        }
      }
    },
    flush,
  };
}

/** Tail a file — reads new lines as they are appended. */
function tailFile(filePath: string, onLine: (line: string) => void): void {
  // Skip existing content, only read new lines
  let fileSize = 0;
  try { fileSize = fs.statSync(filePath).size; } catch { /* file may not exist yet */ }

  let buffer = '';
  let position = fileSize;

  function readNewContent(): void {
    let currentSize: number;
    try { currentSize = fs.statSync(filePath).size; } catch { return; }

    // File was truncated/rotated — reset to beginning
    if (currentSize < position) position = 0;
    if (currentSize === position) return;

    const stream = fs.createReadStream(filePath, { start: position, end: currentSize - 1, encoding: 'utf-8' });
    stream.on('data', (chunk) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop()!; // keep incomplete last line in buffer
      for (const line of lines) {
        if (line.length > 0) onLine(line);
      }
    });
    stream.on('end', () => { position = currentSize; });
  }

  // Poll for changes every 250ms
  console.log(`[dsd] Tailing file: ${filePath} (from byte ${fileSize})`);
  setInterval(readNewContent, 250);

  // Also watch for fs events (faster than polling when available)
  try {
    fs.watch(filePath, () => readNewContent());
  } catch { /* fs.watch not always available, polling is the fallback */ }
}

export function startDsdReader(onEvent: (event: DmrEvent) => void): void {
  const { processLine, flush } = createLineProcessor(onEvent);

  if (config.watchFile) {
    // File-watching mode — tail DSD+ log file
    console.log(`[dsd] Mode: file watch (${config.watchFile})`);
    tailFile(config.watchFile, processLine);
  } else {
    // Stdin mode — pipe DSD+ output
    console.log('[dsd] Mode: stdin pipe');
    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    rl.on('line', processLine);
    rl.on('close', () => {
      flush();
      console.log('[dsd] stdin closed — exiting');
      process.exit(0);
    });
  }
}
