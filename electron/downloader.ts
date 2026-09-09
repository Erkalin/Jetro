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

function isAbortedError(e: any): boolean {
  return String(e?.message || e).includes('aborted');
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

/** Transient failures worth retrying automatically instead of surfacing as an error. */
function isRetryableError(e: any): boolean {
  if (!e || isAbortedError(e)) return false;
  const code = String((e as any)?.code || '');
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
  // Try HEAD first
  try {
    const { res, url } = await requestOnce(urlStr, {}, 'HEAD', proxyOpts);
    const len = Number(res.headers['content-length'] || 0);
    const accept = (res.headers['accept-ranges'] || '').toString();
    res.resume();
    if (len > 0) {
      return {
        totalBytes: len,
        supportsRange: accept.includes('bytes'),
        filename: guessFilename(url, res.headers['content-disposition'] as string, res.headers['content-type'] as string),
        contentType: (res.headers['content-type'] as string) || '',
      };
    }
  } catch {}
  // Fallback: Range 0-0
  const { res, url } = await requestOnce(urlStr, { Range: 'bytes=0-0' }, 'GET', proxyOpts);
  const range = (res.headers['content-range'] as string) || '';
  const m = /bytes \d+-\d+\/(\d+)/.exec(range);
  res.resume();
  if (m) {
    return {
      totalBytes: Number(m[1]),
      supportsRange: true,
      filename: guessFilename(url, res.headers['content-disposition'] as string, res.headers['content-type'] as string),
      contentType: (res.headers['content-type'] as string) || '',
    };
  }
  const len = Number(res.headers['content-length'] || 0);
  return {
    totalBytes: len,
    supportsRange: false,
    filename: guessFilename(url, undefined, (res.headers['content-type'] as string) || ''),
    contentType: (res.headers['content-type'] as string) || '',
  };
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

  onProgress: ProgressCb = () => {};
  onSegments: SegmentCb = () => {};

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
    } catch {}
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
    const once = () =>
      new Promise<void>((resolve, reject) => {
      const attempt = async (redirectUrl: string, redirects: number) => {
        if (this.aborted) return reject(new Error('aborted'));
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
              if (this.aborted) {
                try {
                  req.destroy(new Error('aborted'));
                } catch {}
                return;
              }
              res.pause();
              try {
                await this.fh!.write(chunk, 0, chunk.length, from + seg.downloaded);
                seg.downloaded += chunk.length;
                this.bytesSinceTick += chunk.length;
                await this.throttle(chunk.length);
              } catch (e) {
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
            // open a fresh socket instead of hanging forever.
            res.on('close', () => {
              if (!done) fail(this.aborted ? new Error('aborted') : new Error('socket hang up'));
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
      if (seg.start + seg.downloaded > seg.end) return;
      try {
        await once();
        return;
      } catch (e) {
        if (isAbortedError(e) || this.aborted) throw new Error('aborted');
        lastErr = e;
        if (!isRetryableError(e) || a === 4) throw e;
        await this.saveState().catch(() => {});
        await sleep(retryDelayMs(a));
      }
    }
    throw lastErr;
  }

  private async singleConnection(): Promise<void> {
    const once = () =>
      new Promise<void>((resolve, reject) => {
      const attempt = async (redirectUrl: string, redirects: number) => {
        if (this.aborted) return reject(new Error('aborted'));
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
            res.on('close', () => {
              if (!done) fail(this.aborted ? new Error('aborted') : new Error('socket hang up'));
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
      try {
        await once();
        return;
      } catch (e) {
        if (isAbortedError(e) || this.aborted) throw new Error('aborted');
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
    const resumed = await this.loadState();
    if (!resumed) {
      const probe = await probeUrl(this.url, this.proxyOpts);
      this.totalBytes = probe.totalBytes;
      this.supportsRange = probe.supportsRange;
    }

    // Fallback: unknown size or no range → single connection
    if (!this.totalBytes || !this.supportsRange) {
      this.numConnections = 1;
      this.startTime = Date.now();
      const tick = setInterval(() => {
        try {
          const s = fs.existsSync(this.filePath) ? fs.statSync(this.filePath).size : 0;
          const el = (Date.now() - this.startTime) / 1000 || 1;
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
      // finalize size
      try {
        this.totalBytes = fs.statSync(this.filePath).size;
      } catch {}
      await this.clearState();
      return;
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
      // Dynamic work-stealing: run segments in parallel, re-split slow tail
      await Promise.all(this.segments.map((s) => this.downloadRange(s)));
      clearInterval(tick);
      const done = this.segments.reduce((a, s) => a + s.downloaded, 0);
      this.onProgress(done, this.totalBytes, 0);
      await this.fh.close();
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
      await this.saveState();
      throw e;
    }
  }
}
