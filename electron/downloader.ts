import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { buildAgentFor, shouldBypassHostname } from './proxy';

export interface Segment {
  index: number;
  start: number;
  end: number;
  downloaded: number; // bytes done within this segment
}

export interface ProbeResult {
  totalBytes: number;
  supportsRange: boolean;
  filename: string;
  contentType: string;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Jetro/0.1 segmented downloader';

export interface ProxyOptions {
  /** Static proxy URL (e.g. http://user:pass@host:8080 or socks5://host:1080). Null = direct. */
  proxyUrl?: string | null;
  /** Bypass list used with static proxyUrl. */
  proxyBypass?: string;
  /** Dynamic resolver (used for system proxy). Takes precedence over proxyUrl when present. */
  getProxyUrl?: (targetUrl: string) => Promise<string | null>;
}

const agentCache = new Map<string, http.Agent | https.Agent>();
function cachedAgent(proxyUrl: string, secure: boolean): http.Agent | https.Agent | undefined {
  const key = `${secure ? 'https' : 'http'}|${proxyUrl}`;
  const hit = agentCache.get(key);
  if (hit) return hit;
  const agent = buildAgentFor(proxyUrl, secure);
  if (agent) {
    if (agentCache.size > 20) agentCache.clear();
    agentCache.set(key, agent);
  }
  return agent;
}

async function agentForRequest(targetUrl: string, opts?: ProxyOptions): Promise<http.Agent | https.Agent | undefined> {
  if (!opts) return undefined;
  let proxyUrl: string | null | undefined;
  if (opts.getProxyUrl) {
    try {
      proxyUrl = await opts.getProxyUrl(targetUrl);
    } catch {
      proxyUrl = opts.proxyUrl ?? null;
    }
  } else {
    proxyUrl = opts.proxyUrl ?? null;
  }
  if (!proxyUrl) return undefined;
  try {
    const hostname = new URL(targetUrl).hostname;
    if (shouldBypassHostname(hostname, opts.proxyBypass || '')) return undefined;
  } catch {
    return undefined;
  }
  const secure = /^https:/i.test(targetUrl);
  try {
    return cachedAgent(proxyUrl, secure);
  } catch {
    return undefined;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETRESET',
  'ENOTCONN',
]);

/** Server answered 200 to a Range request: retrying the range is pointless, fall back. */
const RANGE_UNSUPPORTED_CODE = 'RANGE_UNSUPPORTED';
/** A response ended before its segment was complete: the remainder must be re-requested. */
const INCOMPLETE_CODE = 'INCOMPLETE_SEGMENT';

function isRangeUnsupportedError(e: any): boolean {
  return (e as any)?.code === RANGE_UNSUPPORTED_CODE;
}

function rangeUnsupportedError(): Error {
  return Object.assign(
    new Error('server ignored Range request (HTTP 200); falling back to single connection'),
    { code: RANGE_UNSUPPORTED_CODE }
  );
}

function incompleteError(): Error {
  return Object.assign(new Error('socket hang up'), { code: INCOMPLETE_CODE });
}

/** The server's Content-Range total disagrees with the probe: adopt it, don't force it. */
const SIZE_CHANGED_CODE = 'SIZE_CHANGED';

function sizeChangedError(total: number): Error {
  return Object.assign(new Error('server reports a different file size: ' + total), {
    code: SIZE_CHANGED_CODE,
    size: total,
  });
}

/** Transient failures worth retrying automatically instead of surfacing as an error. */
function isRetryableError(e: any): boolean {
  if (!e) return false;
  const code = String((e as any)?.code || '');
  // Never retry: the server doesn't honor ranges (caller falls back instead).
  if (code === RANGE_UNSUPPORTED_CODE) return false;
  // Size changes are handled by the driver (adopt + re-drive), not retried here.
  if (code === SIZE_CHANGED_CODE) return false;
  // A truncated segment is always worth re-requesting.
  if (code === INCOMPLETE_CODE) return true;
  // NOTE: no message sniffing for 'aborted' here. Node reports a server-side
  // connection kill as ECONNRESET with message 'aborted' — that is a network
  // failure, not a user pause. Genuine pauses are detected via this.aborted
  // in the retry loops before this function is ever consulted.
  if (RETRYABLE_CODES.has(code)) return true;
  const msg = String(e?.message || e).toLowerCase();
  if (msg.includes('socket hang up') || msg.includes('socket hung up') || msg.includes('hang up')) return true;
  if (msg.includes('timeout') || msg.includes('timed out')) return true;
  const m = /http (\d{3})/.exec(msg);
  if (m) {
    const s = Number(m[1]);
    if (s === 408 || s === 429 || (s >= 500 && s < 600)) return true;
    return false;
  }
  return false;
}

/** Exponential backoff with jitter: ~400ms, 800ms, 1.6s, 3.2s, … capped at 8s. */
function retryDelayMs(attempt: number): number {
  return Math.min(8000, 400 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

function requestOnce(
  urlStr: string,
  headers: Record<string, string>,
  method = 'GET',
  proxyOpts?: ProxyOptions,
  tries = 3
): Promise<{ res: http.IncomingMessage; url: string }> {
  const once = () =>
    new Promise<{ res: http.IncomingMessage; url: string }>((resolve, reject) => {
    const doReq = async (u: string, redirects: number) => {
      const url = new URL(u);
      const lib = url.protocol === 'https:' ? https : http;
      let agent: http.Agent | https.Agent | undefined;
      try {
        agent = await agentForRequest(u, proxyOpts);
      } catch {
        agent = undefined;
      }
      const req = lib.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          method,
          headers: { 'User-Agent': UA, ...headers },
          agent,
        },
        (res) => {
          const loc = res.headers.location;
          if (loc && res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && redirects < 5) {
            res.resume();
            doReq(new URL(loc, u).toString(), redirects + 1).catch(reject);
            return;
          }
          resolve({ res, url: u });
        }
      );
      req.on('error', reject);
      req.setTimeout(15000, () => req.destroy(new Error('timeout')));
      req.end();
    };
    doReq(urlStr, 0).catch(reject);
  });
  return (async () => {
    let lastErr: any = null;
    for (let a = 0; a < tries; a++) {
      try {
        return await once();
      } catch (e) {
        lastErr = e;
        if (!isRetryableError(e) || a === tries - 1) throw e;
        await sleep(retryDelayMs(a));
      }
    }
    throw lastErr;
  })();
}

export async function probeUrl(urlStr: string, proxyOpts?: ProxyOptions): Promise<ProbeResult> {
  // Authoritative size first: GET bytes=0-0. A 206's Content-Range total is
  // the server's own statement of the transfer size; HEAD Content-Length is
  // only a hint (servers often report a different length for HEAD than for
  // the GET that follows, which used to show up as "227 KB / 176 KB").
  try {
    const { res, url } = await requestOnce(urlStr, { Range: 'bytes=0-0' }, 'GET', proxyOpts);
    const range = ((res.headers['content-range'] as string) || '').trim();
    const m = /^bytes \d+-\d+\/(\d+)$/.exec(range);
    const disp = res.headers['content-disposition'] as string;
    const type = (res.headers['content-type'] as string) || '';
    if (res.statusCode === 206 && m) {
      res.resume(); // 1-byte body, safe to drain
      return {
        totalBytes: Number(m[1]),
        supportsRange: true,
        filename: guessFilename(url, disp, type),
        contentType: type,
      };
    }
    if (res.statusCode === 206) {
      // 206 without a usable total (e.g. "bytes 0-0/*"): ranges work, but the
      // size must come from HEAD below.
      res.resume();
      const head = await headProbe(url, proxyOpts).catch(() => null);
      return {
        totalBytes: head?.totalBytes || 0,
        supportsRange: true,
        filename: guessFilename(url, disp, type),
        contentType: type,
      };
    }
    // 200 (or anything else): the server ignores ranges. Destroy — don't
    // resume — so we don't stream a potentially huge body just to probe it.
    try {
      res.destroy();
    } catch {}
    const head = await headProbe(url, proxyOpts).catch(() => null);
    if (head && head.totalBytes > 0) {
      return { ...head, supportsRange: false };
    }
    return {
      totalBytes: 0,
      supportsRange: false,
      filename: guessFilename(url, disp, type),
      contentType: type,
    };
  } catch {
    // Range request itself failed (blocked method, network blip, …): HEAD.
    const head = await headProbe(urlStr, proxyOpts);
    return head;
  }
}

/** HEAD probe: size hint + metadata. Never trusted over a Content-Range total. */
async function headProbe(urlStr: string, proxyOpts?: ProxyOptions): Promise<ProbeResult> {
  const { res, url } = await requestOnce(urlStr, {}, 'HEAD', proxyOpts);
  const len = Number(res.headers['content-length'] || 0);
  const accept = (res.headers['accept-ranges'] || '').toString();
  res.resume(); // HEAD has no body
  return {
    totalBytes: len > 0 ? len : 0,
    supportsRange: accept.includes('bytes'),
    filename: guessFilename(url, res.headers['content-disposition'] as string, res.headers['content-type'] as string),
    contentType: (res.headers['content-type'] as string) || '',
  };
}

/** Authoritative total for the transfer behind one response, or 0 if unknown. */
function totalFromHeaders(res: http.IncomingMessage, rangeStart: number): number {
  const cr = res.headers['content-range'];
  if (typeof cr === 'string') {
    const m = /bytes \d+-\d+\/(\d+)/.exec(cr.trim());
    if (m) return Number(m[1]);
  }
  const len = Number(res.headers['content-length'] || 0);
  if (len <= 0) return 0;
  if (res.statusCode === 200) return len; // full body from byte 0
  if (res.statusCode === 206) return rangeStart + len; // open-ended "bytes=N-" runs to EOF
  return 0;
}

export function guessFilename(url: string, disposition?: string, contentType?: string): string {
  if (disposition) {
    const m = /filename\*?=(?:UTF-8'')?"?([^";\n]+)/i.exec(disposition);
    if (m) return decodeURIComponent(m[1].replace(/"/g, '')).trim();
  }
  try {
    const u = new URL(url);
    const base = path.basename(u.pathname.split('?')[0]) || 'download';
    if (base && base !== '/') return decodeURIComponent(base);
  } catch {}
  return 'download.bin';
}

export type ProgressCb = (downloaded: number, total: number, speedBps: number) => void;
export type SegmentCb = (segments: Segment[]) => void;

export class SegmentedDownload {
  url: string;
  filePath: string;
  numConnections: number;
  totalBytes = 0;
  supportsRange = false;
  segments: Segment[] = [];
  aborted = false;
  paused = false;
  private fh: fs.promises.FileHandle | null = null;
  private startTime = 0;
  private bytesSinceTick = 0;
  speedBps = 0;
  speedLimitBps = 0; // 0 = unlimited
  statePath: string;
  proxyOpts?: ProxyOptions;
  /** In-flight requests, so pause() can fail them fast instead of leaking. */
  private activeReqs = new Set<any>();
  /** Agents owned by this run — fresh sockets, never reused from a previous run. */
  private runAgents = new Map<string, http.Agent | https.Agent>();
  /**
   * Generation counter: bumped on every run() and before the single-connection
   * fallback. Lets stale segment attempts from a superseded phase fail fast
   * instead of writing into (or re-saving state for) the new phase.
   */
  private runId = 0;

  onProgress: ProgressCb = () => {};
  onSegments: SegmentCb = () => {};
  /** Serializes saveState() writes so they can't tear the resume file. */
  private saveQueue: Promise<void> = Promise.resolve();
  /**
   * Probe result from an earlier call (e.g. the add-dialog probe). Used instead
   * of probing a second time when there is no resume state — two probes of a
   * dynamic URL can disagree, which used to show different totals per attempt.
   */
  seedProbe?: ProbeResult;

  constructor(url: string, filePath: string, numConnections = 8, speedLimitBps = 0, proxyOpts?: ProxyOptions) {
    this.url = url;
    this.filePath = filePath;
    this.numConnections = Math.min(Math.max(1, numConnections), 32);
    this.speedLimitBps = speedLimitBps;
    this.statePath = filePath + '.jetro.json';
    this.proxyOpts = proxyOpts;
  }

  updateProxy(proxyOpts?: ProxyOptions) {
    this.proxyOpts = proxyOpts;
  }

  async loadState(): Promise<boolean> {
    try {
      const raw = await fs.promises.readFile(this.statePath, 'utf8');
      const s = JSON.parse(raw);
      if (s.url === this.url && s.totalBytes > 0) {
        this.totalBytes = s.totalBytes;
        this.supportsRange = s.supportsRange;
        this.segments = s.segments;
        return true;
      }
    } catch {}
    return false;
  }

  async saveState() {
    const prev = this.saveQueue;
    let release!: () => void;
    this.saveQueue = new Promise<void>((r) => {
      release = r;
    });
    // Serialize writes: the progress tick fires every 500ms and must never
    // interleave two writes into a torn resume file (which would discard all
    // progress on the next resume).
    try {
      await prev;
    } catch {}
    try {
      await fs.promises.writeFile(
        this.statePath,
        JSON.stringify({
          url: this.url,
          totalBytes: this.totalBytes,
          supportsRange: this.supportsRange,
          segments: this.segments,
        })
      );
    } catch {} finally {
      release();
    }
  }

  async clearState() {
    try {
      await fs.promises.unlink(this.statePath);
    } catch {}
  }

  pause() {
    this.paused = true;
    this.aborted = true;
    // Fail fast: error-out every in-flight request so run() settles immediately
    // and the runner can be dropped. Destroying WITH an error guarantees the
    // pending promises reject — a bare destroy() can leave them hanging forever
    // (no 'end'/'error'), leaking the runner and blocking the next resume.
    for (const req of this.activeReqs) {
      try {
        req.destroy(new Error('aborted'));
      } catch {}
    }
    this.activeReqs.clear();
  }

  /**
   * Per-run agents: resume must never reuse keep-alive sockets pooled by a
   * previous run — the server has typically closed those while we were paused,
   * so the first request on each dead socket fails with "socket hang up".
   * Fresh agents per run + destroy at the end eliminates that entirely.
   */
  private async agentForRun(targetUrl: string): Promise<http.Agent | https.Agent | undefined> {
    let proxyUrl: string | null | undefined;
    if (this.proxyOpts?.getProxyUrl) {
      try {
        proxyUrl = await this.proxyOpts.getProxyUrl(targetUrl);
      } catch {
        proxyUrl = this.proxyOpts.proxyUrl ?? null;
      }
    } else {
      proxyUrl = this.proxyOpts?.proxyUrl ?? null;
    }
    if (proxyUrl) {
      try {
        const hostname = new URL(targetUrl).hostname;
        if (shouldBypassHostname(hostname, this.proxyOpts?.proxyBypass || '')) proxyUrl = null;
      } catch {
        proxyUrl = null;
      }
    }
    const secure = /^https:/i.test(targetUrl);
    const key = `${secure ? 'https' : 'http'}|${proxyUrl || 'direct'}`;
    const hit = this.runAgents.get(key);
    if (hit) return hit;
    let agent: http.Agent | https.Agent | undefined;
    try {
      agent = proxyUrl
        ? buildAgentFor(proxyUrl, secure)
        : secure
          ? new https.Agent({ keepAlive: true })
          : new http.Agent({ keepAlive: true });
    } catch {
      agent = undefined;
    }
    if (agent) this.runAgents.set(key, agent);
    return agent;
  }

  private destroyRunAgents() {
    for (const a of this.runAgents.values()) {
      try {
        (a as any).destroy();
      } catch {}
    }
    this.runAgents.clear();
    for (const req of this.activeReqs) {
      try {
        req.destroy();
      } catch {}
    }
    this.activeReqs.clear();
  }

  private async throttle(n: number) {
    if (!this.speedLimitBps) return;
    // simple token bucket: expected time for n bytes
    const expectedMs = (n / this.speedLimitBps) * 1000;
    if (expectedMs > 2) await new Promise((r) => setTimeout(r, expectedMs));
  }

  private async downloadRange(seg: Segment): Promise<void> {
    const myRun = this.runId;
    const stale = () => myRun !== this.runId;
    const once = () =>
      new Promise<void>((resolve, reject) => {
      const attempt = async (redirectUrl: string, redirects: number) => {
        if (this.aborted) return reject(new Error('aborted'));
        if (stale()) return reject(new Error('stale run'));
        const from = seg.start + seg.downloaded;
        if (from > seg.end) return resolve();
        const url = new URL(redirectUrl);
        const lib = url.protocol === 'https:' ? https : http;
        // Fresh per-run agent (never a dead pooled socket from before the pause).
        const agent = await this.agentForRun(redirectUrl).catch(() => undefined);
        const req = lib.request(
          {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: 'GET',
            headers: {
              'User-Agent': UA,
              Range: `bytes=${from}-${seg.end}`,
              Connection: 'keep-alive',
            },
            agent,
          },
          (res) => {
            if (
              res.statusCode &&
              [301, 302, 303, 307, 308].includes(res.statusCode) &&
              res.headers.location &&
              redirects < 5
            ) {
              res.resume();
              attempt(new URL(res.headers.location, redirectUrl).toString(), redirects + 1).catch(reject);
              return;
            }
            if (res.statusCode !== 206 && res.statusCode !== 200) {
              res.resume();
              return reject(new Error('HTTP ' + res.statusCode));
            }
            if (res.statusCode === 200) {
              // We always send a Range header here: 200 means the server
              // ignored it and is streaming the whole file. Writing that into
              // one segment's slice would re-download the file N times and
              // corrupt it — bail out so run() can fall back to 1 connection.
              // Destroy (don't resume): the data handler below must never see
              // a single byte of this body.
              try {
                req.destroy();
              } catch {}
              return reject(rangeUnsupportedError());
            }
            // When the server tells us which range it sent, make sure it is
            // the one we asked for instead of silently writing wrong bytes.
            // A disagreeing total means the file changed size since the probe:
            // adopt it (handled by the driver) instead of downloading a
            // wrong amount — never more, never less.
            const contentRange = res.headers['content-range'];
            if (typeof contentRange === 'string') {
              const cm = /bytes (\d+)-\d+\/(\d+|\*)/.exec(contentRange.trim());
              if (cm && Number(cm[1]) !== from) {
                try {
                  req.destroy();
                } catch {}
                return reject(
                  Object.assign(
                    new Error(`server returned range starting at ${cm[1]}, expected ${from}`),
                    { code: INCOMPLETE_CODE }
                  )
                );
              }
              if (cm && cm[2] !== '*' && Number(cm[2]) !== this.totalBytes) {
                try {
                  req.destroy();
                } catch {}
                return reject(sizeChangedError(Number(cm[2])));
              }
            }
            let done = false;
            const fail = (e: any) => {
              if (!done) {
                done = true;
                reject(e);
              }
            };
            const win = () => {
              if (!done) {
                done = true;
                resolve();
              }
            };
            res.on('data', async (chunk: Buffer) => {
              if (stale()) {
                try {
                  req.destroy();
                } catch {}
                return;
              }
              if (this.aborted) {
                try {
                  req.destroy(new Error('aborted'));
                } catch {}
                return;
              }
              res.pause();
              try {
                // Write position must be derived from live progress: `from`
                // already contains the progress made before this attempt, so
                // `from + seg.downloaded` would double-count it on retries.
                const pos = seg.start + seg.downloaded;
                const remaining = seg.end - pos + 1;
                if (remaining <= 0) {
                  win();
                  try {
                    req.destroy();
                  } catch {}
                  return;
                }
                const buf = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
                await this.fh!.write(buf, 0, buf.length, pos);
                if (stale()) {
                  // Superseded mid-write (size adoption re-drives): don't
                  // count this chunk — the re-driven attempt refetches it.
                  try {
                    req.destroy();
                  } catch {}
                  return;
                }
                seg.downloaded += buf.length;
                this.bytesSinceTick += buf.length;
                await this.throttle(buf.length);
                if (seg.start + seg.downloaded > seg.end) {
                  // Segment complete: stop the (possibly longer) response now
                  // instead of downloading bytes we will throw away.
                  win();
                  try {
                    req.destroy();
                  } catch {}
                  return;
                }
              } catch (e) {
                // Surface the real error (e.g. disk failure) instead of
                // masking it as a network problem via the 'close' handler.
                fail(e);
                try {
                  req.destroy(e as Error);
                } catch {}
                return;
              }
              if (this.aborted) return fail(new Error('aborted'));
              res.resume();
            });
            res.on('end', win);
            res.on('error', fail);
            // Server closed the connection without finishing (the classic
            // post-pause "socket hang up"): fail fast so the retry loop can
            // open a fresh socket instead of hanging forever. res.complete
            // guards the benign close that follows a fully received message.
            res.on('close', () => {
              if (!done && !res.complete) fail(this.aborted ? new Error('aborted') : new Error('socket hang up'));
            });
          }
        );
        this.activeReqs.add(req);
        req.on('close', () => this.activeReqs.delete(req));
        req.on('error', reject);
        req.setTimeout(20000, () => req.destroy(new Error('segment timeout')));
        req.end();
      };
      attempt(this.url, 0).catch(reject);
    });
    // Retry transient failures (stale pooled socket closed while paused,
    // server throttling the reconnect burst, …) so one bad attempt doesn't
    // fail the whole download and force a manual resume.
    if (seg.index > 0) await sleep(Math.min(seg.index * 40, 600));
    let lastErr: any = null;
    for (let a = 0; a < 5; a++) {
      if (this.aborted) throw new Error('aborted');
      if (stale()) throw new Error('stale run');
      if (seg.start + seg.downloaded > seg.end) return;
      try {
        await once();
        // A clean 'end' doesn't prove we got every byte (a truncated 206
        // still ends cleanly): only stop when the segment is actually full,
        // otherwise re-request the remainder instead of leaving a hole.
        if (seg.start + seg.downloaded > seg.end) return;
        throw incompleteError();
      } catch (e) {
        if (this.aborted) throw new Error('aborted');
        if (stale()) throw new Error('stale run');
        lastErr = e;
        if (!isRetryableError(e) || a === 4) throw e;
        if (!stale()) await this.saveState().catch(() => {});
        await sleep(retryDelayMs(a));
      }
    }
    throw lastErr;
  }

  private async singleConnection(): Promise<void> {
    const myRun = this.runId;
    const stale = () => myRun !== this.runId;
    const once = () =>
      new Promise<void>((resolve, reject) => {
      const attempt = async (redirectUrl: string, redirects: number) => {
        if (this.aborted) return reject(new Error('aborted'));
        if (stale()) return reject(new Error('stale run'));
        const url = new URL(redirectUrl);
        const lib = url.protocol === 'https:' ? https : http;
        // resume via existing file size
        let start = 0;
        try {
          start = fs.existsSync(this.filePath) ? fs.statSync(this.filePath).size : 0;
        } catch {}
        const headers: Record<string, string> = { 'User-Agent': UA };
        if (start > 0) headers['Range'] = `bytes=${start}-`;
        // Fresh per-run agent (never a dead pooled socket from before the pause).
        const agent = await this.agentForRun(redirectUrl).catch(() => undefined);
        const req = lib.request(
          {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: 'GET',
            headers,
            agent,
          },
          (res) => {
            if (
              res.statusCode &&
              [301, 302, 303, 307, 308].includes(res.statusCode) &&
              res.headers.location &&
              redirects < 5
            ) {
              res.resume();
              attempt(new URL(res.headers.location, redirectUrl).toString(), redirects + 1).catch(reject);
              return;
            }
            if (!res.statusCode || res.statusCode >= 400) {
              res.resume();
              return reject(new Error('HTTP ' + res.statusCode));
            }
            // Trust this transfer's own headers over the earlier probe: if the
            // file changed size between probing and downloading, the progress
            // display (and completion check) must follow reality, not the
            // stale probe — this is what used to show "227 KB / 176 KB".
            // Only authoritative statements (a full 200 body, or an explicit
            // Content-Range total) may shrink the target: a short 206 without
            // Content-Range is just a guess and must only ever grow it.
            const transferTotal = totalFromHeaders(res, start);
            if (transferTotal > 0) {
              const authoritative =
                res.statusCode === 200 || typeof res.headers['content-range'] === 'string';
              this.totalBytes = authoritative ? transferTotal : Math.max(this.totalBytes, transferTotal);
            }
            const ws = fs.createWriteStream(this.filePath, { flags: start > 0 && res.statusCode === 206 ? 'a' : 'w' });
            let done = false;
            const fail = (e: any) => {
              if (!done) {
                done = true;
                try {
                  ws.destroy();
                } catch {}
                reject(e);
              }
            };
            res.on('data', (c: Buffer) => {
              this.bytesSinceTick += c.length;
              this.throttle(c.length);
            });
            res.pipe(ws);
            ws.on('finish', () => {
              if (!done) {
                done = true;
                resolve();
              }
            });
            ws.on('error', fail);
            res.on('error', fail);
            // Server closed the connection without finishing: fail fast so the
            // retry loop can open a fresh socket instead of hanging forever.
            // res.complete guards the benign close that follows a fully
            // received message (it can fire before ws 'finish' flushes).
            res.on('close', () => {
              if (!done && !res.complete) fail(this.aborted ? new Error('aborted') : new Error('socket hang up'));
            });
          }
        );
        this.activeReqs.add(req);
        req.on('close', () => this.activeReqs.delete(req));
        req.on('error', reject);
        req.setTimeout(30000, () => req.destroy(new Error('timeout')));
        req.end();
      };
      attempt(this.url, 0).catch(reject);
    });
    let lastErr: any = null;
    for (let a = 0; a < 3; a++) {
      if (this.aborted) throw new Error('aborted');
      if (stale()) throw new Error('stale run');
      try {
        await once();
        // A clean stream end doesn't prove the whole file arrived (a
        // truncated response still ends cleanly): when the size is known,
        // only stop once it is on disk, otherwise resume the remainder.
        if (this.totalBytes > 0) {
          let size = 0;
          try {
            size = fs.statSync(this.filePath).size;
          } catch {}
          if (size >= this.totalBytes) return;
          throw incompleteError();
        }
        return;
      } catch (e) {
        if (this.aborted) throw new Error('aborted');
        if (stale()) throw new Error('stale run');
        lastErr = e;
        if (!isRetryableError(e) || a === 2) throw e;
        await sleep(retryDelayMs(a));
      }
    }
    throw lastErr;
  }

  async run(): Promise<void> {
    this.aborted = false;
    this.paused = false;
    this.runId++;
    const resumed = await this.loadState();
    if (!resumed) {
      if (this.seedProbe && this.seedProbe.totalBytes > 0) {
        this.totalBytes = this.seedProbe.totalBytes;
        this.supportsRange = this.seedProbe.supportsRange;
      } else {
        const probe = await probeUrl(this.url, this.proxyOpts);
        this.totalBytes = probe.totalBytes;
        this.supportsRange = probe.supportsRange;
      }
    }

    // Fallback: unknown size or no range → single connection
    if (!this.totalBytes || !this.supportsRange) {
      return this.runSingle();
    }

    // Segmented path
    if (!resumed || !this.segments.length) {
      const per = Math.floor(this.totalBytes / this.numConnections);
      this.segments = [];
      for (let i = 0; i < this.numConnections; i++) {
        const start = i * per;
        const end = i === this.numConnections - 1 ? this.totalBytes - 1 : (i + 1) * per - 1;
        this.segments.push({ index: i, start, end, downloaded: 0 });
      }
    }

    // Pre-allocate file
    const dir = path.dirname(this.filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      const fh0 = await fs.promises.open(this.filePath, 'w');
      await fh0.truncate(this.totalBytes);
      await fh0.close();
    } else {
      const st = await fs.promises.stat(this.filePath);
      if (st.size !== this.totalBytes) {
        const fh0 = await fs.promises.open(this.filePath, 'r+');
        await fh0.truncate(this.totalBytes);
        await fh0.close();
      }
    }

    this.fh = await fs.promises.open(this.filePath, 'r+');
    await this.driveSegments();
  }

  /**
   * Drives all segments to completion with `this.fh` open. If a server mid-way
   * reports a different total than the probe, the new size is adopted (file
   * resized, segments re-sliced around existing progress) and the remainder
   * is re-driven — so exactly the real amount is downloaded, never more.
   */
  private async driveSegments(): Promise<void> {
    this.startTime = Date.now();

    const tick = setInterval(() => {
      const done = this.segments.reduce((a, s) => a + s.downloaded, 0);
      // account for previously resumed bytes stored? downloaded already counts them
      this.speedBps = Math.round(this.bytesSinceTick * 2); // 500ms window
      this.bytesSinceTick = 0;
      this.onProgress(done, this.totalBytes, this.speedBps);
      this.onSegments(this.segments);
      this.saveState();
    }, 500);

    try {
      for (let round = 0; ; round++) {
        try {
          // Dynamic work-stealing: run segments in parallel, re-split slow tail
          await Promise.all(this.segments.map((s) => this.downloadRange(s)));
          break;
        } catch (e) {
          const size = Number((e as any)?.size || 0);
          if (
            round < 3 &&
            (e as any)?.code === SIZE_CHANGED_CODE &&
            !this.aborted &&
            size > 0 &&
            size !== this.totalBytes &&
            (await this.adoptSize(size))
          ) {
            continue; // re-drive remaining bytes under the adopted size
          }
          throw e;
        }
      }
      clearInterval(tick);
      const done = this.segments.reduce((a, s) => a + s.downloaded, 0);
      this.onProgress(done, this.totalBytes, 0);
      await this.fh!.close();
      this.fh = null;
      this.destroyRunAgents();
      if (!this.aborted) await this.clearState();
      else throw new Error('aborted');
    } catch (e) {
      clearInterval(tick);
      try {
        await this.fh?.close();
      } catch {}
      this.fh = null;
      this.destroyRunAgents();
      if (isRangeUnsupportedError(e) && !this.aborted) {
        // The server advertised ranges but answers 200 with the whole file.
        // The pre-allocated file only holds partial garbage: drop it and the
        // segment state, then download once over a single connection.
        // Bump the generation first so straggler segment attempts from this
        // phase fail fast instead of interfering with the fallback.
        this.runId++;
        this.supportsRange = false;
        this.numConnections = 1;
        this.segments = [];
        try {
          await fs.promises.unlink(this.filePath);
        } catch {}
        await this.clearState();
        return this.runSingle();
      }
      await this.saveState();
      throw e;
    }
  }

  /**
   * Adopt a server-reported total mid-download, preserving bytes already
   * secured. Grows: extend the file and queue one tail segment. Shrinks:
   * clamp segments and truncate. Either way the previous round's streams are
   * parked first — a stale stream writing concurrently with the re-driven one
   * would double-count and corrupt.
   */
  private async adoptSize(newTotal: number): Promise<boolean> {
    try {
      if (!this.fh) return false;
      this.runId++;
      this.destroyRunAgents();
      if (newTotal > this.totalBytes) {
        await this.fh.truncate(newTotal);
        const index =
          this.segments.length > 0 ? Math.max(...this.segments.map((s) => s.index)) + 1 : 0;
        this.segments.push({ index, start: this.totalBytes, end: newTotal - 1, downloaded: 0 });
        this.totalBytes = newTotal;
        await this.saveState();
        return true;
      }
      this.totalBytes = newTotal;
      for (const s of this.segments) {
        if (s.start >= newTotal) {
          s.end = s.start - 1; // empty range: counts as complete, contributes 0
          s.downloaded = 0;
        } else if (s.end >= newTotal) {
          s.end = newTotal - 1;
          s.downloaded = Math.min(s.downloaded, s.end - s.start + 1);
        }
      }
      await this.fh.truncate(newTotal);
      await this.saveState();
      return true;
    } catch {
      return false;
    }
  }

  /** Single-connection download (used when ranges are unavailable or ignored). */
  private async runSingle(): Promise<void> {
    this.numConnections = 1;
    this.startTime = Date.now();
    const tick = setInterval(() => {
      try {
        const s = fs.existsSync(this.filePath) ? fs.statSync(this.filePath).size : 0;
        this.speedBps = Math.round(this.bytesSinceTick);
        this.bytesSinceTick = 0;
        this.onProgress(s, this.totalBytes || s, this.speedBps);
      } catch {}
    }, 500);
    try {
      await this.singleConnection();
    } finally {
      clearInterval(tick);
      this.destroyRunAgents();
    }
    // finalize size: the file on disk is the truth
    try {
      this.totalBytes = fs.statSync(this.filePath).size;
    } catch {}
    this.onProgress(this.totalBytes, this.totalBytes, 0);
    await this.clearState();
  }
}
