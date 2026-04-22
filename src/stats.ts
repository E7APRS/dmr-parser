/**
 * Runtime statistics tracker for the DMR parser health page.
 */

export interface RecentEvent {
  dmrId: number;
  callsign: string | null;
  lat?: number;
  lon?: number;
  posted: boolean;
  reason?: string;
  at: string;
}

const MAX_RECENT = 30;

export const stats = {
  startedAt: new Date().toISOString(),

  // Counters
  linesRead: 0,
  dmrEventsTotal: 0,
  dmrEventsWithGps: 0,
  dmrEventsNoGps: 0,
  debounced: 0,
  lookupSuccess: 0,
  lookupFail: 0,
  postsAttempted: 0,
  postsSuccess: 0,
  postsFailed: 0,

  // Recent events ring buffer
  recent: [] as RecentEvent[],
};

export function addRecent(event: RecentEvent): void {
  stats.recent.unshift(event);
  if (stats.recent.length > MAX_RECENT) stats.recent.length = MAX_RECENT;
}
