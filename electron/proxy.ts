import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
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

export interface NetworkSettings extends ProxySettings {
  vpnKillSwitch: boolean;
}

export function defaultNetworkSettings(): NetworkSettings {
  return {
    proxyMode: 'none',
    proxyType: 'http',
    proxyHost: '',
    proxyPort: 8080,
    proxyUser: '',
    proxyPass: '',
    proxyBypass: 'localhost,127.0.0.1,::1',
    vpnKillSwitch: false,
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
    vpnKillSwitch: !!s.vpnKillSwitch,
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

// ---------- VPN ----------

export interface VpnInterfaceInfo {
  name: string;
  addresses: string[];
}

export interface VpnStatus {
  vpnDetected: boolean;
  interfaces: VpnInterfaceInfo[];
  totalInterfaces: number;
}

function looksLikeVpn(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.includes('tun') ||
    n.includes('tap') ||
    n.includes('ppp') ||
    n.includes('pptp') ||
    n.includes('l2tp') ||
    n.includes('wireguard') ||
    n === 'wg0' ||
    n.startsWith('wg') ||
    n.includes('tailscale') ||
    n.includes('zerotier') ||
    n.includes('vpn') ||
    n.includes('utun')
  );
}

export function getVpnStatus(): VpnStatus {
  let all: NodeJS.Dict<os.NetworkInterfaceInfo[]>;
  try {
    all = os.networkInterfaces();
  } catch {
    return { vpnDetected: false, interfaces: [], totalInterfaces: 0 };
  }
  const names = Object.keys(all);
  const found: VpnInterfaceInfo[] = [];
  for (const name of names) {
    const list = (all[name] || []).filter((a) => !a.internal);
    if (!list.length) continue;
    if (looksLikeVpn(name)) {
      found.push({ name, addresses: list.map((a) => a.address) });
    }
  }
  // Windows: adapter names often generic ("Ethernet 2") even for VPN — also match known virtual MAC vendors? Keep name-based + non-internal check is best-effort.
  return { vpnDetected: found.length > 0, interfaces: found, totalInterfaces: names.length };
}

/** Public IP via ipify (respects optional proxy URL). Best-effort, short timeout. */
export function getPublicIp(proxyUrl?: string | null, timeoutMs = 9000): Promise<string> {
  return new Promise((resolve, reject) => {
    const target = 'https://api.ipify.org?format=json';
    const agent = buildAgentFor(proxyUrl || null, true);
    const req = https.get(
      target,
      {
        agent,
        headers: { 'User-Agent': 'Jetro/0.1', Accept: 'application/json' },
      },
      (res) => {
        if (!res.statusCode || res.statusCode >= 400) {
          res.resume();
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }
        let body = '';
        res.on('data', (c) => {
          body += c;
          if (body.length > 4096) req.destroy(new Error('response too large'));
        });
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            if (j.ip) resolve(String(j.ip));
            else reject(new Error('bad response'));
          } catch (e) {
            reject(e instanceof Error ? e : new Error('bad response'));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
  });
}
