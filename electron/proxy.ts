import * as http from 'http';
import * as https from 'https';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

export type ProxyMode = 'none' | 'system' | 'custom';
export type ProxyType = 'http' | 'https' | 'socks4' | 'socks5';

export interface ProxySettings {
  proxyMode: ProxyMode;
  proxyType: ProxyType;
  proxyHost: string;
  proxyPort: number;
  proxyUser: string;
  proxyPass: string;
  proxyBypass: string; // comma / semicolon / space separated hosts
}

export type NetworkSettings = ProxySettings;

export function defaultNetworkSettings(): NetworkSettings {
  return {
    proxyMode: 'none',
    proxyType: 'http',
    proxyHost: '',
    proxyPort: 8080,
    proxyUser: '',
    proxyPass: '',
    proxyBypass: 'localhost,127.0.0.1,::1',
  };
}

export function normalizeNetworkSettings(s: any): NetworkSettings {
  const d = defaultNetworkSettings();
  if (!s || typeof s !== 'object') return d;
  const mode = s.proxyMode === 'system' || s.proxyMode === 'custom' || s.proxyMode === 'none' ? s.proxyMode : d.proxyMode;
  const type =
    s.proxyType === 'https' || s.proxyType === 'socks4' || s.proxyType === 'socks5' || s.proxyType === 'http'
      ? s.proxyType
      : d.proxyType;
  const port = Math.min(65535, Math.max(1, Number(s.proxyPort) || d.proxyPort));
  return {
    proxyMode: mode,
    proxyType: type,
    proxyHost: String(s.proxyHost || '').trim(),
    proxyPort: port,
    proxyUser: String(s.proxyUser || ''),
    proxyPass: String(s.proxyPass || ''),
    proxyBypass: typeof s.proxyBypass === 'string' ? s.proxyBypass : d.proxyBypass,
  };
}

function splitBypassList(bypass: string): string[] {
  return String(bypass || '')
    .split(/[;,\s]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

const ALWAYS_DIRECT = new Set(['localhost', '127.0.0.1', '::1']);

/** True when hostname should bypass the proxy (matches suffix / wildcard, case-insensitive). */
export function shouldBypassHostname(hostname: string, bypass: string): boolean {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (!host) return true;
  if (ALWAYS_DIRECT.has(host)) return true;
  for (const rule of splitBypassList(bypass)) {
    const r = rule.replace(/^\[(.*)\]$/, '$1');
    if (!r) continue;
    if (r === '*') return true;
    if (r.startsWith('*.')) {
      const suffix = r.slice(1); // ".example.com"
      if (host.endsWith(suffix) || host === suffix.slice(1)) return true;
      continue;
    }
    if (r.startsWith('.')) {
      if (host.endsWith(r) || host === r.slice(1)) return true;
      continue;
    }
    if (host === r) return true;
  }
  return false;
}

export function buildCustomProxyUrl(cfg: Pick<ProxySettings, 'proxyType' | 'proxyHost' | 'proxyPort' | 'proxyUser' | 'proxyPass'>): string | null {
  const host = String(cfg.proxyHost || '').trim();
  const port = Number(cfg.proxyPort);
  if (!host || !port || port < 1 || port > 65535) return null;
  const scheme = cfg.proxyType === 'https' ? 'http' : cfg.proxyType; // https-proxy-agent handles TLS-to-proxy via http:// URL
  const auth =
    cfg.proxyUser || cfg.proxyPass
      ? `${encodeURIComponent(cfg.proxyUser)}:${encodeURIComponent(cfg.proxyPass)}@`
      : '';
  return `${scheme}://${auth}${host}:${port}`;
}

interface ParsedSystemProxy {
  scheme: string; // http | https | socks4 | socks5 | socks
  host: string;
  port: number;
}

/** Parse Electron/Chromium proxy string ("PROXY h:p; SOCKS5 h:p; DIRECT") → first usable entry. */
export function parseSystemProxyString(proxyStr: string): ParsedSystemProxy | null {
  const parts = String(proxyStr || '')
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean);
  for (const part of parts) {
    const upper = part.toUpperCase();
    if (upper === 'DIRECT') continue;
    let m = /^(PROXY|HTTPS)\s+([^:\s]+):(\d+)/i.exec(part);
    if (m) return { scheme: 'http', host: m[2], port: Number(m[3]) };
    m = /^(SOCKS5?|SOCKS4?)\s+([^:\s]+):(\d+)/i.exec(part);
    if (m) {
      const kind = m[1].toUpperCase();
      const scheme = kind === 'SOCKS4' ? 'socks4' : kind === 'SOCKS' ? 'socks5' : 'socks5';
      return { scheme, host: m[2], port: Number(m[3]) };
    }
  }
  return null;
}

export function systemProxyToUrl(p: ParsedSystemProxy): string {
  const scheme = p.scheme === 'socks' ? 'socks5' : p.scheme;
  return `${scheme}://${p.host}:${p.port}`;
}

function envProxyFor(targetUrl: string): string | null {
  const isHttps = /^https:/i.test(targetUrl);
  const raw =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    (isHttps ? null : process.env.HTTP_PROXY || process.env.http_proxy) ||
    process.env.ALL_PROXY ||
    process.env.all_proxy ||
    null;
  if (!raw) return null;
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
    if (!u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}

async function sessionProxyRaw(targetUrl: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { session } = require('electron');
    const ses = session?.defaultSession;
    if (!ses?.resolveProxy) return null;
    const raw = await ses.resolveProxy(targetUrl);
    return typeof raw === 'string' && raw ? raw : null;
  } catch {
    return null;
  }
}

export interface EffectiveProxy {
  proxyUrl: string | null;
  source: 'none' | 'custom' | 'system-session' | 'system-env';
  raw?: string;
}

/** Resolve the concrete proxy URL for one download URL (null = direct). */
export async function resolveEffectiveProxyUrl(targetUrl: string, cfg: ProxySettings): Promise<EffectiveProxy> {
  let hostname = '';
  try {
    hostname = new URL(targetUrl).hostname;
  } catch {
    return { proxyUrl: null, source: 'none' };
  }
  if (cfg.proxyMode === 'none') return { proxyUrl: null, source: 'none' };
  if (cfg.proxyMode === 'custom') {
    if (shouldBypassHostname(hostname, cfg.proxyBypass)) return { proxyUrl: null, source: 'none' };
    const url = buildCustomProxyUrl(cfg);
    return { proxyUrl: url, source: 'custom' };
  }
  // system
  const raw = await sessionProxyRaw(targetUrl);
  if (raw) {
    const parsed = parseSystemProxyString(raw);
    if (!parsed) return { proxyUrl: null, source: 'system-session', raw }; // DIRECT
    if (shouldBypassHostname(hostname, cfg.proxyBypass)) return { proxyUrl: null, source: 'system-session', raw };
    return { proxyUrl: systemProxyToUrl(parsed), source: 'system-session', raw };
  }
  const env = envProxyFor(targetUrl);
  if (env) {
    if (shouldBypassHostname(hostname, cfg.proxyBypass)) return { proxyUrl: null, source: 'system-env' };
    return { proxyUrl: env, source: 'system-env' };
  }
  return { proxyUrl: null, source: 'none' };
}

/** Build a Node http/https agent for one proxy URL (null = direct, no custom agent). */
export function buildAgentFor(proxyUrl: string | null, secure: boolean): http.Agent | https.Agent | undefined {
  if (!proxyUrl) return undefined;
  const lower = proxyUrl.toLowerCase();
  try {
    if (lower.startsWith('socks')) return new SocksProxyAgent(proxyUrl) as unknown as https.Agent;
    if (secure) return new HttpsProxyAgent(proxyUrl) as unknown as https.Agent;
    return new HttpProxyAgent(proxyUrl) as unknown as http.Agent;
  } catch {
    return undefined;
  }
}

/** Apply proxy to Chromium session so in-app web requests honor it. Best-effort. */
export async function applySessionProxy(cfg: ProxySettings): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { session } = require('electron');
    const ses = session?.defaultSession;
    if (!ses?.setProxy) return;
    if (cfg.proxyMode === 'none') {
      await ses.setProxy({ mode: 'direct' });
      return;
    }
    if (cfg.proxyMode === 'system') {
      await ses.setProxy({ mode: 'system' });
      return;
    }
    const url = buildCustomProxyUrl(cfg);
    if (!url) {
      await ses.setProxy({ mode: 'direct' });
      return;
    }
    const u = new URL(url);
    const auth = u.username ? `${u.username}:${u.password}@` : '';
    const hostPort = `${u.hostname}:${u.port || (u.protocol.startsWith('socks') ? '1080' : '8080')}`;
    const isSocks = u.protocol.startsWith('socks');
    const proxyRules = isSocks
      ? `socks=${auth}${hostPort}`
      : `http=${auth}${hostPort};https=${auth}${hostPort}`;
    const extraBypass = splitBypassList(cfg.proxyBypass).join(';');
    const proxyBypassRules = extraBypass || '<local>';
    await ses.setProxy({ proxyRules, proxyBypassRules });
  } catch {
    // never break startup over proxy
  }
}
