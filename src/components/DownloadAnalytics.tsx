import { useEffect, useState } from 'react';
import {
  FiActivity, FiClock, FiCpu, FiExternalLink, FiFolder, FiGlobe,
  FiLayers, FiPause, FiPlay, FiRotateCcw, FiTrendingUp, FiZap,
} from 'react-icons/fi';
import type { Item } from '@/types';
import { fmtBytes, fmtEta, fmtSize, fmtSpeed, formatEtaSec, statusColor, statusLabel } from '@/lib/format';
import { hasBackend } from '@/api/jetro';
import { useLanguage } from '@/locale/LanguageContext';
import OsFileIcon from '@/components/OsFileIcon';
import SpeedGraph from '@/components/SpeedGraph';
import type { SpeedStats } from '@/hooks/useSpeedHistory';

interface Props {
  item: Item;
  queueName: string | null;
  stats: SpeedStats;
  onClose: () => void;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export default function DownloadAnalytics({ item, queueName, stats, onClose }: Props) {
  const { t } = useLanguage();
  const [segInfo, setSegInfo] = useState<DownloadSegmentsInfo | null>(null);

  // Poll per-connection progress while the modal is open.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        if (!window.jetro?.getSegments) return;
        const r = await window.jetro.getSegments(item.id);
        if (alive) setSegInfo(r);
      } catch {
        // Keep the last snapshot on transient IPC errors.
      }
    };
    load();
    const t = setInterval(load, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [item.id]);

  const completed = item.status === 'completed';
  const active = item.status === 'downloading' || item.status === 'merging';
  const pausable = active || item.status === 'queued';
  const resumable = item.status === 'paused' || item.status === 'error';
  const pct = item.totalBytes ? Math.min(100, (item.downloadedBytes / item.totalBytes) * 100) : 0;
  const total = item.totalBytes || item.downloadedBytes || 0;
  const attempts = Math.max(0, Math.round(Number(item.attempts) || 0));
  const host = segInfo?.host || hostnameOf(item.url);
  const hostIp = host ? (segInfo?.ip ? `${host} • ${segInfo.ip}` : host) : '';
  const geo = segInfo?.geo || null;
  const flagCode = geo?.countryCode ? geo.countryCode.toLowerCase() : null;
  // Flag asset (remote image, same mechanism as the Google Fonts already in use).
  const flagUrl = flagCode ? `https://flagcdn.com/w80/${flagCode}.png` : null;
  const [flagOk, setFlagOk] = useState(true);
  // Prefer the resolved location; fall back to host • ip while it loads or offline.
  const serverLabel = geo?.label || hostIp || '—';
  const serverTitle = [geo?.label, hostIp].filter(Boolean).join(' — ') || '—';

  // Segment rows: live/paused snapshots from the backend, a full single row
  // for finished downloads, otherwise an honest "unavailable" note.
  let segments: DownloadSegmentInfo[] | null = segInfo?.segments || null;
  if (!segments && completed && total > 0) {
    segments = [{ index: 0, start: 0, end: total - 1, downloaded: total }];
  }
  const segTotal = segments
    ? segments.reduce((a, s) => a + Math.max(0, Math.min(s.downloaded, s.end - s.start + 1)), 0)
    : 0;

  // Stabilized long-window ETA; instantaneous only as a warm-up fallback.
  // When paused, freeze the last known value instead of blanking to '—'.
  // stats.etaSec is retained in useSpeedHistory while inactive (no updates),
  // so reading it while paused naturally yields the frozen value.
  const isPaused = item.status === 'paused';
  const liveEta =
    stats.etaSec != null ? formatEtaSec(stats.etaSec) : fmtEta(item, stats.avg);
  const stableEta = completed ? '—' : active || isPaused ? liveEta : '—';

  const tiles = [
    { icon: FiZap, label: t.analytics.current, value: active ? fmtSpeed(item.speedBps || 0) : '—', accent: active },
    { icon: FiActivity, label: t.analytics.average, value: stats.avg ? fmtSpeed(stats.avg) : '—', accent: false },
    { icon: FiTrendingUp, label: t.analytics.peak, value: stats.peak ? fmtSpeed(stats.peak) : '—', accent: false },
    { icon: FiClock, label: t.analytics.remaining, value: stableEta, accent: false },
    {
      icon: FiCpu,
      label: t.analytics.connections,
      value: `${item.connections || 1}x${item.supportsRange ? '' : t.analytics.single}`,
      accent: false,
    },
    { icon: FiRotateCcw, label: t.analytics.retries, value: String(attempts), accent: attempts > 0 },
  ];

  const openFile = async () => {
    if (!hasBackend()) return;
    try {
      await window.jetro!.openFile(item.savePath);
    } catch (e: any) {
      alert(e?.message || t.common.couldNotOpenFile);
    }
  };
  const openFolder = async () => {
    if (!hasBackend()) return;
    try {
      await window.jetro!.revealInFolder(item.savePath);
    } catch (e: any) {
      alert(e?.message || t.common.couldNotOpenFolder);
    }
  };

  return (
    <div className="modal-overlay analytics-overlay" onClick={onClose}>
      <div className="modal analytics-modal" onClick={(e) => e.stopPropagation()}>
        <div className="analytics-head">
          <div className="complete-file-icon analytics-icon">
            <OsFileIcon item={item} />
          </div>
          <div className="complete-file-info">
            <div className="complete-file-name" title={`${item.filename}\n${item.savePath}`}>
              {item.filename}
            </div>
            <div className="complete-file-meta">
              <span className="analytics-status" style={{ color: statusColor(item.status) }}>
                {statusLabel(item.status, t.status)}
              </span>
              <span className="complete-dot-sep">•</span>
              <span className="analytics-url" title={item.url}>
                {item.url}
              </span>
            </div>
            <div className="complete-file-meta analytics-server" title={serverTitle}>
              {flagUrl && flagOk && (
                <img
                  src={flagUrl}
                  alt=""
                  className="analytics-flag"
                  draggable={false}
                  onError={() => setFlagOk(false)}
                />
              )}
              <FiGlobe className="inline-icon" />
              <span>{serverLabel}</span>
              {queueName && (
                <>
                  <span className="complete-dot-sep">•</span>
                  <FiLayers className="inline-icon" />
                  <span>{queueName}</span>
                </>
              )}
            </div>
          </div>
          <div className="analytics-pct">
            <span className="analytics-pct-num">{completed ? 100 : pct.toFixed(1)}</span>
            <span className="analytics-pct-sign">%</span>
          </div>
        </div>

        <div className="analytics-progress">
          <div className="analytics-progress-fill" style={{ width: `${completed ? 100 : pct}%` }} />
        </div>
        <div className="analytics-progress-meta">
          <span>
            {completed
              ? fmtBytes(total)
              : `${fmtBytes(item.downloadedBytes || 0)} / ${fmtSize(total, !!item.totalBytesIsEstimate)}`}
          </span>
          <span>{active ? `${fmtSpeed(item.speedBps || 0)} • ${t.analytics.etaPrefix}${stableEta}` : statusLabel(item.status, t.status)}</span>
        </div>

        {(pausable || resumable) && (
          <div className="row analytics-controls">
            {pausable ? (
              <button
                className="btn analytics-control-btn"
                title={t.list.pauseTitle}
                onClick={() => window.jetro?.pause(item.id)}
              >
                <FiPause className="btn-icon" /> {t.common.pause}
              </button>
            ) : (
              <button
                className="btn btn-primary analytics-control-btn"
                title={t.list.resumeTitle}
                onClick={() => window.jetro?.resume(item.id)}
              >
                <FiPlay className="btn-icon" /> {t.common.resume}
              </button>
            )}
          </div>
        )}

        <div className="analytics-tiles">
          {tiles.map((t) => (
            <div className={'analytics-tile' + (t.accent ? ' hot' : '')} key={t.label}>
              <t.icon className="analytics-tile-icon" />
              <div className="analytics-tile-label">{t.label}</div>
              <div className="analytics-tile-value">{t.value}</div>
            </div>
          ))}
        </div>

        <div className="analytics-section-title">
          <FiActivity className="inline-icon" /> {t.analytics.speedTitle}
          {active && <span className="analytics-live">{t.analytics.live}</span>}
        </div>
        <SpeedGraph samples={stats.samples} live={active} />

        <div className="analytics-section-title">
          <FiCpu className="inline-icon" /> {t.analytics.connsTitle}
        </div>
        {segments && segments.length > 0 ? (
          <div className="analytics-conns">
            {segments.map((s) => {
              const size = Math.max(0, s.end - s.start + 1);
              const done = Math.max(0, Math.min(s.downloaded, size || s.downloaded));
              const sp = size > 0 ? Math.min(100, (done / size) * 100) : completed ? 100 : 0;
              const share = segTotal > 0 ? (done / segTotal) * 100 : 0;
              return (
                <div className="analytics-conn" key={s.index}>
                  <div className="analytics-conn-top">
                    <span className="analytics-conn-name">
                      {segments!.length > 1 ? t.analytics.conn(s.index + 1) : t.analytics.singleStream}
                    </span>
                    <span className="analytics-conn-bytes">
                      {fmtBytes(done)}
                      {size > 0 && t.analytics.ofSize(fmtBytes(size))} • {share.toFixed(1)}%
                    </span>
                  </div>
                  <div className="analytics-conn-track">
                    <div className="analytics-conn-fill" style={{ width: `${sp}%` }} />
                  </div>
                </div>
              );
            })}
            <div className="analytics-conns-foot">
              {segInfo && !segInfo.live && !completed
                ? t.analytics.lastLayout
                : t.analytics.across(fmtBytes(segTotal), segments.length)}
            </div>
          </div>
        ) : (
          <div className="analytics-note">
            {t.analytics.unavailable}
            {item.via === 'ytdlp' ? ` ${t.analytics.viaYtdlp}` : ` ${t.analytics.notStarted}`}.
          </div>
        )}

        <div className="row analytics-actions">
          {completed && (
            <button className="btn" onClick={openFile}>
              <FiExternalLink className="btn-icon" /> {t.analytics.openFile}
            </button>
          )}
          <button className="btn" onClick={openFolder}>
            <FiFolder className="btn-icon" /> {t.analytics.showFolder}
          </button>
          <button className="btn btn-primary" autoFocus onClick={onClose}>
            {t.common.close}
          </button>
        </div>
      </div>
    </div>
  );
}
