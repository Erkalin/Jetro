// Browser-extension handoff card, standalone or overlay.
import { useEffect, useRef, useState } from 'react';
import {
  FiCheck,
  FiClock,
  FiCopy,
  FiDownloadCloud,
  FiFilm,
  FiFolder,
  FiGlobe,
  FiRefreshCw,
  FiSettings,
} from 'react-icons/fi';
import { MdExtension } from 'react-icons/md';
import CategoryIcon from '@/components/CategoryIcon';
import jetroLogo from '@/assets/Jetro-notext.png';
import { categoryDirKeyForFilename } from '@/lib/category';
import type { AppStrings } from '@/locale/en';
import type { Queue } from '@/types';

export interface BrowserDownloadDialogProps {
  t: AppStrings;
  bare: boolean;
  standalone: boolean;
  url: string;
  source: string;
  queuedCount: number;
  urlError: string;
  filename: string;
  filenameError: string;
  probedFilename: string;
  savePath: string;
  rememberPath: boolean;
  categoryLabel: string;
  conns: number;
  connsOptions: number[];
  queueId: string;
  queues: Queue[];
  videoQueueId: string;
  adding: boolean;
  isVideoPage: boolean;
  isKnownVideoPage: boolean;
  isPotentialVideo: boolean;
  forceVideo: boolean;
  videoLoading: boolean;
  videoFormats: VideoFormat[];
  videoHint: string;
  videoDetail: string;
  showVideoDetail: boolean;
  videoTitle: string;
  videoProxyHint: boolean;
  needsCookies: boolean;
  cookiesText: string;
  cookiesFile: string;
  cookieError: string;
  selectedVideoUrl: string;
  selectedVideoHeight: number;
  selectedVideoNeedsMerge: boolean;
  selectedVideoKind: 'video' | 'audio' | '';
  selectedVideoExt: string;
  selectedVideoEstimatedBytes: number;
  videoSubtitles: boolean;
  hasVideoSelection: boolean;
  videoDetectFailed: boolean;
  videoResolved: boolean;
  playlist: { title: string; count: number; entries: PlaylistEntry[] } | null;
  playlistSelected: Set<string>;
  playlistAdding: boolean;
  proxyModeLabel: string;
  formatSize: (n: number) => string;
  cleanPastedUrl: (raw: string) => string | null;
  onUrlChange: (v: string) => void;
  onFilenameChange: (v: string) => void;
  onSavePathChange: (v: string) => void;
  onPickFolder: () => void;
  onRememberChange: (v: boolean) => void;
  onConnsChange: (v: number) => void;
  onQueueChange: (v: string) => void;
  onVideoQueueChange: (v: string) => void;
  onCreateQueue: (target: 'newDownload' | 'video') => void;
  onForceVideoDetect: () => void;
  onRevertToFile: () => void;
  onDetectVideo: () => void;
  onSelectVideo: (f: VideoFormat) => void;
  onSelectAudio: (f: VideoFormat) => void;
  onSubtitlesChange: (v: boolean) => void;
  onToggleVideoDetail: () => void;
  onCookiesText: (v: string) => void;
  onCookiesFile: (v: string) => void;
  onPickCookieFile: () => void;
  onOpenCookieExtension: () => void;
  onOpenProxySettings: () => void;
  onSelectAllPlaylist: () => void;
  onClearPlaylist: () => void;
  onTogglePlaylistEntry: (key: string) => void;
  onStartPlaylist: () => void;
  onStartNow: () => void;
  onDownloadLater: () => void;
  onCancel: () => void;
}

function sourceLabelFor(t: AppStrings, source: string): string {
  const b = t.browserDownload;
  switch ((source || '').toLowerCase()) {
    case 'link':
      return b.sourceLink;
    case 'image':
      return b.sourceImage;
    case 'media':
      return b.sourceMedia;
    case 'frame':
      return b.sourceFrame;
    case 'selection':
      return b.sourceSelection;
    case 'page':
      return b.sourcePage;
    case 'tab':
      return b.sourceTab;
    case 'download':
      return b.sourceDownload;
    default:
      return b.sourceUnknown;
  }
}

function categoryIconCat(filename: string, probed: string, videoKind: string): string {
  if (videoKind === 'audio') return 'audio';
  if (videoKind === 'video') return 'video';
  try {
    const key = categoryDirKeyForFilename((filename || '').trim() || probed || 'file.bin');
    switch (key) {
      case 'video':
        return 'video';
      case 'music':
        return 'audio';
      case 'archives':
        return 'compressed';
      case 'documents':
        return 'document';
      case 'software':
        return 'program';
      default:
        return 'other';
    }
  } catch {
    return 'other';
  }
}

export default function BrowserDownloadDialog(props: BrowserDownloadDialogProps) {
  const { t } = props;
  const b = t.browserDownload;
  const n = t.newDownload;
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current != null) {
        try {
          window.clearTimeout(copyTimer.current);
        } catch {}
      }
    },
    [],
  );

  const headerName =
    props.filename.trim() ||
    props.probedFilename ||
    props.videoTitle ||
    b.title;
  const showFilenameBox =
    props.url.trim() !== '' &&
    (!props.isKnownVideoPage || props.hasVideoSelection || props.videoDetectFailed);
  const showConnsRow =
    !((props.isKnownVideoPage || (props.forceVideo && props.videoResolved)) && !props.videoDetectFailed);

  const copyLink = async () => {
    const v = (props.url || '').trim();
    if (!v) return;
    try {
      await navigator.clipboard.writeText(v);
    } catch {
      return;
    }
    setCopied(true);
    if (copyTimer.current != null) {
      try {
        window.clearTimeout(copyTimer.current);
      } catch {}
    }
    copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  const headerMeta = [b.fromSource(sourceLabelFor(t, props.source)), props.categoryLabel]
    .filter(Boolean)
    .join(' • ');

  const body = (
    <>
      <div className="bd-accent" aria-hidden="true" />
      <header className="bd-header">
        <div className="bd-file-tile" aria-hidden="true">
          <CategoryIcon cat={categoryIconCat(props.filename, props.probedFilename, props.selectedVideoKind)} size={18} />
        </div>
        <div className="bd-title-wrap">
          <h2 className="bd-title" title={headerName}>
            {headerName}
          </h2>
          <div className="bd-sub" title={b.subtitle}>
            <span className="bd-sub-text">{headerMeta}</span>
            {props.queuedCount > 0 && (
              <span className="bd-queued" title={`${props.queuedCount} more link(s) underneath`}>
                {b.queuedBadge(props.queuedCount)}
              </span>
            )}
          </div>
        </div>
        <img src={jetroLogo} alt="Jetro" className="bd-logo" draggable={false} aria-hidden="true" />
      </header>

      <div className="bd-body">
        <div className="bd-form">
          <section className="bd-section">
            <label className="form-label bd-label">{b.urlLabel}</label>
            <div className="bd-url-row">
              <input
                className="input bd-input"
                autoFocus
                dir="ltr"
                placeholder={n.urlPlaceholder}
                value={props.url}
                onChange={(e) => props.onUrlChange(e.target.value)}
                onPaste={(e) => {
                  try {
                    const raw = String(e.clipboardData?.getData('text') || '');
                    if (!raw || !/[\s"'<>]/.test(raw)) return;
                    const cleaned = props.cleanPastedUrl(raw);
                    if (cleaned) {
                      e.preventDefault();
                      props.onUrlChange(cleaned);
                    }
                  } catch {
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') props.onStartNow();
                }}
                style={props.urlError ? { borderColor: 'var(--red)' } : undefined}
              />
              <button
                type="button"
                className={'btn bd-icon-btn' + (copied ? ' is-ok' : '')}
                title={copied ? b.copied : b.copyLinkTitle}
                aria-label={b.copyLinkTitle}
                onClick={copyLink}
              >
                {copied ? <FiCheck size={15} /> : <FiCopy size={15} />}
              </button>
            </div>
            {copied && <div className="bd-copied-hint" role="status">{b.copied}</div>}
            {props.urlError && <div className="form-error">{props.urlError}</div>}
            {props.isPotentialVideo && !props.forceVideo && (
              <div className="bd-video-toggle">
                <button type="button" className="btn btn-small" disabled={props.videoLoading} onClick={props.onForceVideoDetect}>
                  <FiFilm className="btn-icon" /> {props.videoLoading ? n.detecting : 'Is this a video/audio page? Click to detect'}
                </button>
              </div>
            )}
          </section>

          {showFilenameBox && (
            <section className="bd-section">
              <label className="form-label bd-label">{n.fileName}</label>
              <input
                className="input bd-input"
                dir="auto"
                placeholder={props.probedFilename || n.fileNamePlaceholder}
                value={props.filename}
                onChange={(e) => props.onFilenameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') props.onStartNow();
                }}
                style={props.filenameError ? { borderColor: 'var(--red)' } : undefined}
              />
              {props.filenameError && <div className="form-error">{props.filenameError}</div>}
              {!props.filenameError && props.probedFilename !== '' && props.probedFilename !== props.filename.trim() && (
                <div className="form-hint">{n.detected(props.probedFilename)}</div>
              )}
            </section>
          )}

          <section className="bd-section">
            <label className="form-label bd-label">{n.saveFolder}</label>
            <div className="save-path-box bd-save-row">
              <input
                className="input bd-input"
                dir="ltr"
                placeholder={t.common.chooseFolder}
                value={props.savePath}
                onChange={(e) => props.onSavePathChange(e.target.value)}
                title={props.savePath}
              />
              <button className="btn bd-icon-btn" title={t.common.chooseFolderTitle} aria-label={t.common.chooseFolderTitle} onClick={props.onPickFolder}>
                <FiFolder size={14} />
              </button>
            </div>
            <label className="bd-remember" title={n.rememberPath(props.categoryLabel)}>
              <input type="checkbox" checked={props.rememberPath} onChange={(e) => props.onRememberChange(e.target.checked)} />
              <span className="bd-remember-text">{n.rememberPath(props.categoryLabel)}</span>
            </label>
          </section>

          {showConnsRow ? (
            <section className="bd-section">
              <div className="bd-opts">
                <div className="bd-field">
                  <label className="form-label bd-label">{t.settings.connections}</label>
                  <select className="input bd-input bd-select" value={props.conns} onChange={(e) => props.onConnsChange(Number(e.target.value))}>
                    {props.connsOptions.map((c) => (
                      <option key={c} value={c}>
                        {t.common.connections(c)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="bd-field">
                  <label className="form-label bd-label">{t.itemMenu.addToQueue}</label>
                  <select
                    className="input bd-input bd-select"
                    value={props.queueId}
                    onChange={(e) => {
                      if (e.target.value === '__new__') props.onCreateQueue('newDownload');
                      else props.onQueueChange(e.target.value);
                    }}
                    title={t.itemMenu.addToQueue}
                  >
                    <option value="">{t.common.noQueue}</option>
                    {props.queues.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.name}
                        {q.running ? t.common.runningSuffix : ''}
                      </option>
                    ))}
                    <option value="__new__">{t.common.newQueueOption}</option>
                  </select>
                </div>
              </div>
            </section>
          ) : (
            <section className="bd-section">
              <div className="queue-note">{n.videoQueueNote}</div>
            </section>
          )}

          {props.url.trim() !== '' && props.isVideoPage && (
            <section className="bd-section bd-video">
              <div className="video-box-desc">{n.videoDesc}</div>
              {props.forceVideo && !props.isKnownVideoPage && (
                <div style={{ marginBottom: 6 }}>
                  <button type="button" className="link-btn" onClick={props.onRevertToFile}>
                    Not a video page — download as a direct file instead
                  </button>
                </div>
              )}
              <button className="btn btn-small" disabled={props.videoLoading} onClick={props.onDetectVideo}>
                <FiFilm className="btn-icon" />{' '}
                {props.videoLoading ? n.detecting : props.videoFormats.length ? n.detectAgain : n.detectQualities}
              </button>
              {props.needsCookies && (
                <div className="cookie-box">
                  <div className="cookie-box-title">{n.cookieTitle}</div>
                  <label className="form-label-sm">{n.cookiePasteLabel}</label>
                  <textarea
                    className="input"
                    dir="ltr"
                    rows={4}
                    placeholder={n.cookiePastePlaceholder}
                    value={props.cookiesText}
                    onChange={(e) => props.onCookiesText(e.target.value)}
                  />
                  <div className="cookie-or">{n.cookieOr}</div>
                  <label className="form-label-sm">{n.cookieFileLabel}</label>
                  <div className="row" style={{ alignItems: 'flex-end' }}>
                    <input
                      className="input"
                      dir="ltr"
                      style={{ flex: 1, minWidth: 0, marginBottom: 0 }}
                      placeholder={n.cookieFilePlaceholder}
                      value={props.cookiesFile}
                      onChange={(e) => props.onCookiesFile(e.target.value)}
                    />
                    <button className="btn btn-small" title={n.cookiePickTitle} onClick={props.onPickCookieFile}>
                      …
                    </button>
                  </div>
                  {props.cookieError && <div className="form-error-mt">{props.cookieError}</div>}
                  <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                    <button className="btn btn-small" title={n.cookieExtensionTitle} onClick={props.onOpenCookieExtension}>
                      <MdExtension className="btn-icon" /> {n.cookieExtension}
                    </button>
                    <button className="btn btn-small btn-primary" disabled={props.videoLoading} onClick={props.onDetectVideo}>
                      <FiFilm className="btn-icon" /> {props.videoLoading ? n.retrying : n.retryCookies}
                    </button>
                  </div>
                </div>
              )}
              {props.videoHint && !props.cookieError && (
                <div className="video-hint">
                  {props.videoTitle ? `${props.videoTitle} — ` : ''}
                  {props.videoHint}
                </div>
              )}
              {props.videoProxyHint && !props.videoLoading && props.videoFormats.length === 0 && (
                <div className="proxy-hint-box" role="alert">
                  <div className="proxy-hint-text">
                    <FiGlobe className="inline-icon" /> {n.detectProxyHint}
                  </div>
                  <div className="proxy-hint-current">
                    {props.proxyModeLabel}
                  </div>
                  <div className="row proxy-hint-actions">
                    {!props.standalone && (
                      <button type="button" className="btn btn-small btn-primary" onClick={props.onOpenProxySettings}>
                        <FiSettings className="btn-icon" /> {n.openProxySettings}
                      </button>
                    )}
                    <button type="button" className="btn btn-small" disabled={props.videoLoading} onClick={props.onDetectVideo}>
                      <FiRefreshCw className="btn-icon" /> {n.detectAgain}
                    </button>
                  </div>
                </div>
              )}
              {props.videoDetail && (
                <div className="video-detail-wrap">
                  <button className="link-btn" onClick={props.onToggleVideoDetail}>
                    {props.showVideoDetail ? n.hideDetails : n.showDetails}
                  </button>
                  {props.showVideoDetail && <pre className="video-detail-log">{props.videoDetail}</pre>}
                </div>
              )}
              {props.videoFormats.filter((f) => (f.kind || 'video') !== 'audio').length > 0 && (
                <>
                  <div className="video-group-label">{n.videoGroup}</div>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    {props.videoFormats
                      .filter((f) => (f.kind || 'video') !== 'audio')
                      .map((f) => {
                        const active =
                          props.selectedVideoKind === 'video' &&
                          props.selectedVideoHeight === (f.height || 0) &&
                          props.selectedVideoExt === String(f.ext || '').toLowerCase();
                        return (
                          <button
                            key={'v-' + f.height + f.quality + (f.needsMerge ? '-m' : '')}
                            className={'btn btn-small' + (active ? ' btn-primary' : '')}
                            onClick={() => props.onSelectVideo(f)}
                          >
                            {f.height ? `${f.height}p` : f.quality} · {f.ext}
                            {f.needsMerge ? n.mergeSuffix : ''}
                            {Number((f as any)?.estimatedBytes || 0) > 0
                              ? ` · ${props.formatSize(Number((f as any).estimatedBytes))}`
                              : ''}
                          </button>
                        );
                      })}
                  </div>
                </>
              )}
              {props.videoFormats.filter((f) => f.kind === 'audio').length > 0 && (
                <>
                  <div className="video-group-label">{n.audioGroup}</div>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    {props.videoFormats
                      .filter((f) => f.kind === 'audio')
                      .map((f) => {
                        const active =
                          props.selectedVideoKind === 'audio' &&
                          props.selectedVideoExt === String(f.ext || '').toLowerCase();
                        return (
                          <button
                            key={'a-' + f.quality + f.ext}
                            className={'btn btn-small' + (active ? ' btn-primary' : '')}
                            onClick={() => props.onSelectAudio(f)}
                          >
                            {f.abr ? `${f.ext} · ${Math.round(f.abr)}k` : `${f.quality} · ${f.ext}`}
                            {Number((f as any)?.estimatedBytes || 0) > 0
                              ? ` · ${props.formatSize(Number((f as any).estimatedBytes))}`
                              : ''}
                          </button>
                        );
                      })}
                  </div>
                </>
              )}
              {!!props.selectedVideoKind && (
                <div className="video-selected">
                  {props.selectedVideoKind === 'audio'
                    ? n.selectedAudio(
                        props.selectedVideoEstimatedBytes > 0 ? props.formatSize(props.selectedVideoEstimatedBytes) : '',
                      )
                    : props.selectedVideoNeedsMerge || !props.selectedVideoUrl
                      ? n.selectedMerge(
                          props.selectedVideoHeight ? String(props.selectedVideoHeight) : '',
                          props.selectedVideoEstimatedBytes > 0 ? props.formatSize(props.selectedVideoEstimatedBytes) : '',
                        )
                      : n.selectedDirect}
                </div>
              )}
              {(props.videoFormats.length > 0 || props.playlist) && (
                <div className="row select-row" style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={props.videoSubtitles}
                      onChange={(e) => props.onSubtitlesChange(e.target.checked)}
                    />{' '}
                    {n.subtitles}
                  </label>
                  <select
                    className="input select-queue"
                    value={props.videoQueueId}
                    onChange={(e) => {
                      if (e.target.value === '__new__') props.onCreateQueue('video');
                      else props.onVideoQueueChange(e.target.value);
                    }}
                    title={n.videoQueueTitle}
                  >
                    <option value="">{t.common.noQueue}</option>
                    {props.queues.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.name}
                        {q.running ? t.common.runningSuffix : ''}
                      </option>
                    ))}
                    <option value="__new__">{t.common.newQueueOption}</option>
                  </select>
                </div>
              )}
              {props.playlist && props.playlist.entries.length > 1 && (
                <div style={{ marginTop: 10 }}>
                  <div className="video-group-label">
                    {n.playlistGroup(
                      props.playlist.count,
                      props.playlist.count > 50 ? n.playlistFirst50 : '',
                      props.playlist.title,
                    )}
                  </div>
                  <div className="row" style={{ marginBottom: 6 }}>
                    <button className="btn btn-small" onClick={props.onSelectAllPlaylist}>
                      {n.selectAll}
                    </button>
                    <button className="btn btn-small" onClick={props.onClearPlaylist}>
                      {n.clear}
                    </button>
                    <span className="queue-meta">{n.playlistSelected(props.playlistSelected.size)}</span>
                  </div>
                  <div className="ctx-queue-list" style={{ maxHeight: 180 }}>
                    {props.playlist.entries.map((en) => {
                      const key = String(en.url);
                      const on = props.playlistSelected.has(key);
                      return (
                        <label key={key} className="ctx-item" style={{ cursor: 'pointer' }} title={en.url}>
                          <input type="checkbox" checked={on} onChange={() => props.onTogglePlaylistEntry(key)} />
                          <span
                            style={{
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {en.title}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <button
                    className="btn btn-primary btn-small"
                    style={{ marginTop: 8 }}
                    disabled={props.playlistAdding || props.playlistSelected.size === 0 || !props.selectedVideoKind}
                    onClick={props.onStartPlaylist}
                  >
                    {props.playlistAdding ? n.playlistAdding : n.playlistDownload(props.playlistSelected.size)}
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      <footer className="bd-actions">
        <button
          type="button"
          className="btn bd-btn"
          disabled={props.adding || props.playlistAdding}
          onClick={props.onDownloadLater}
        >
          <FiClock className="btn-icon" size={13} /> {b.downloadLater}
        </button>
        <button
          type="button"
          className="btn btn-primary bd-btn bd-btn-primary"
          autoFocus
          disabled={props.adding}
          onClick={props.onStartNow}
        >
          <FiDownloadCloud className="btn-icon" size={13} /> {props.adding ? n.starting : b.startNow}
        </button>
        <button type="button" className="btn bd-btn" onClick={props.onCancel}>
          {t.common.cancel}
        </button>
      </footer>
    </>
  );

  if (props.bare) {
    return (
      <div className="browser-modal bare">
        <div className="bd-fit">{body}</div>
      </div>
    );
  }
  return (
    <div className="browser-modal-overlay">
      <div className="browser-modal" onClick={(e) => e.stopPropagation()}>
        {body}
      </div>
    </div>
  );
}
