/**
 * Minimal HTTP health/status page for the DMR parser.
 * Uses Node.js built-in http module — no external dependencies.
 */
import http from 'http';
import { config } from './config';
import { stats } from './stats';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(' ');
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 1000) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

function buildJson() {
  return {
    status: 'ok',
    service: 'dmr-parser',
    now: new Date().toISOString(),
    startedAt: stats.startedAt,
    uptimeMs: Date.now() - new Date(stats.startedAt).getTime(),
    backend: config.backendUrl,
    debounceSec: config.debounceSec,
    counters: {
      linesRead: stats.linesRead,
      dmrEventsTotal: stats.dmrEventsTotal,
      dmrEventsWithGps: stats.dmrEventsWithGps,
      dmrEventsNoGps: stats.dmrEventsNoGps,
      debounced: stats.debounced,
      lookupSuccess: stats.lookupSuccess,
      lookupFail: stats.lookupFail,
      postsAttempted: stats.postsAttempted,
      postsSuccess: stats.postsSuccess,
      postsFailed: stats.postsFailed,
    },
    recent: stats.recent,
  };
}

function buildHtml(): string {
  const data = buildJson();
  const uptime = formatUptime(data.uptimeMs);

  const recentRows = stats.recent.length > 0
    ? stats.recent.map(e => {
        const pos = e.lat !== undefined ? `${e.lat.toFixed(5)}, ${e.lon!.toFixed(5)}` : '—';
        return `
        <tr>
          <td><code>${e.dmrId}</code></td>
          <td>${e.callsign ? `<strong>${escapeHtml(e.callsign)}</strong>` : '<span class="muted">unknown</span>'}</td>
          <td>${pos}</td>
          <td>${e.posted
            ? '<span class="badge" style="background:#c6f6d5;color:#22543d">POSTED</span>'
            : `<span class="badge" style="background:#fed7d7;color:#822727">SKIP</span> <span class="muted">${escapeHtml(e.reason ?? '')}</span>`
          }</td>
          <td>${timeAgo(e.at)}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="5" class="muted">No events yet — waiting for DSD+ input</td></tr>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DMR Parser — Health</title>
  <meta http-equiv="refresh" content="10" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1117; color: #e2e8f0; padding: 1.5rem; }
    .container { max-width: 900px; margin: 0 auto; }
    .header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #2d3748; }
    .header h1 { font-size: 1.4rem; color: #ff6600; font-weight: 700; }
    .header .pill { font-size: 0.75rem; padding: 0.2rem 0.6rem; border-radius: 999px; background: #c6f6d5; color: #22543d; font-weight: 600; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.75rem; margin-bottom: 1.5rem; }
    .stat { background: #1a1f2e; border: 1px solid #2d3748; border-radius: 8px; padding: 1rem; }
    .stat .label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: #718096; margin-bottom: 0.25rem; }
    .stat .value { font-size: 1.3rem; font-weight: 700; color: #f7fafc; }
    .stat .value.orange { color: #ff6600; }
    .card { background: #1a1f2e; border: 1px solid #2d3748; border-radius: 8px; margin-bottom: 1rem; overflow: hidden; }
    .card-title { font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #a0aec0; padding: 0.75rem 1rem; border-bottom: 1px solid #2d3748; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { text-align: left; padding: 0.5rem 1rem; color: #718096; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #2d3748; }
    td { padding: 0.5rem 1rem; border-bottom: 1px solid #2d374833; color: #cbd5e0; }
    tr:last-child td { border-bottom: none; }
    .badge { display: inline-block; font-size: 0.65rem; font-weight: 700; padding: 0.15rem 0.5rem; border-radius: 4px; letter-spacing: 0.03em; }
    .muted { color: #4a5568; font-size: 0.8rem; }
    code { background: #2d3748; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.8rem; color: #e2e8f0; }
    .config { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 1rem; font-size: 0.85rem; }
    .config dt { color: #718096; }
    .config dd { color: #cbd5e0; }
    .footer { text-align: center; font-size: 0.7rem; color: #4a5568; margin-top: 1.5rem; }
    .bar { display: flex; gap: 0; height: 6px; border-radius: 3px; overflow: hidden; margin-top: 0.75rem; }
    .bar > div { height: 100%; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>DMR Parser</h1>
      <span class="pill">RUNNING</span>
    </div>

    <div class="grid">
      <div class="stat">
        <div class="label">Uptime</div>
        <div class="value">${uptime}</div>
      </div>
      <div class="stat">
        <div class="label">Lines Read</div>
        <div class="value orange">${stats.linesRead.toLocaleString()}</div>
      </div>
      <div class="stat">
        <div class="label">DMR Events</div>
        <div class="value orange">${stats.dmrEventsTotal.toLocaleString()}</div>
      </div>
      <div class="stat">
        <div class="label">With GPS</div>
        <div class="value">${stats.dmrEventsWithGps.toLocaleString()}</div>
      </div>
      <div class="stat">
        <div class="label">Posted</div>
        <div class="value" style="color:#68d391">${stats.postsSuccess.toLocaleString()}</div>
      </div>
      <div class="stat">
        <div class="label">Failed</div>
        <div class="value" style="color:${stats.postsFailed > 0 ? '#fc8181' : '#f7fafc'}">${stats.postsFailed.toLocaleString()}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Pipeline</div>
      <div style="padding: 1rem;">
        <div class="config">
          <dt>DSD+ lines →</dt><dd><strong>${stats.linesRead.toLocaleString()}</strong> read</dd>
          <dt>DMR IDs parsed →</dt><dd><strong>${stats.dmrEventsTotal.toLocaleString()}</strong> events (${stats.dmrEventsWithGps} with GPS, ${stats.dmrEventsNoGps} without)</dd>
          <dt>Debounced →</dt><dd><strong>${stats.debounced.toLocaleString()}</strong> suppressed</dd>
          <dt>RadioID lookups →</dt><dd><strong>${stats.lookupSuccess.toLocaleString()}</strong> found, <strong>${stats.lookupFail.toLocaleString()}</strong> failed</dd>
          <dt>Backend POST →</dt><dd><strong>${stats.postsSuccess.toLocaleString()}</strong> ok, <strong>${stats.postsFailed.toLocaleString()}</strong> failed</dd>
        </div>
        ${stats.dmrEventsTotal > 0 ? `
        <div class="bar">
          ${stats.postsSuccess > 0 ? `<div style="flex:${stats.postsSuccess};background:#68d391" title="Posted: ${stats.postsSuccess}"></div>` : ''}
          ${stats.dmrEventsNoGps > 0 ? `<div style="flex:${stats.dmrEventsNoGps};background:#718096" title="No GPS: ${stats.dmrEventsNoGps}"></div>` : ''}
          ${stats.debounced > 0 ? `<div style="flex:${stats.debounced};background:#f6ad55" title="Debounced: ${stats.debounced}"></div>` : ''}
          ${stats.lookupFail > 0 ? `<div style="flex:${stats.lookupFail};background:#fc8181" title="Lookup failed: ${stats.lookupFail}"></div>` : ''}
          ${stats.postsFailed > 0 ? `<div style="flex:${stats.postsFailed};background:#e53e3e" title="POST failed: ${stats.postsFailed}"></div>` : ''}
        </div>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card-title">Configuration</div>
      <div style="padding: 1rem;">
        <div class="config">
          <dt>Backend</dt><dd><code>${escapeHtml(config.backendUrl)}</code></dd>
          <dt>API Key</dt><dd>${config.gpsApiKey ? '<span class="badge" style="background:#c6f6d5;color:#22543d">SET</span>' : '<span class="badge" style="background:#fed7d7;color:#822727">NOT SET</span>'}</dd>
          <dt>Debounce</dt><dd>${config.debounceSec}s</dd>
          <dt>Debug</dt><dd>${config.debug ? 'ON' : 'OFF'}</dd>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Recent Events (last ${stats.recent.length})</div>
      <table>
        <thead><tr><th>DMR-ID</th><th>Callsign</th><th>Position</th><th>Result</th><th>When</th></tr></thead>
        <tbody>${recentRows}</tbody>
      </table>
    </div>

    <div class="footer">Auto-refreshes every 10s &middot; <code>${escapeHtml(data.now)}</code></div>
  </div>
</body>
</html>`;
}

export function startHealthServer(): void {
  const port = config.healthPort;

  const server = http.createServer((req, res) => {
    if (req.url !== '/' && req.url !== '/health') {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const accept = req.headers.accept ?? '';
    if (accept.includes('application/json') && !accept.includes('html')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(buildJson()));
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buildHtml());
    }
  });

  server.listen(port, () => {
    console.log(`[health] Status page: http://localhost:${port}`);
  });
}
