import { useEffect, useMemo, useState } from 'react';
import {
  FiArrowDown,
  FiArrowUp,
  FiCalendar,
  FiCheck,
  FiClock,
  FiFolder,
  FiPlay,
  FiPlus,
  FiPower,
  FiRefreshCw,
  FiSquare,
  FiTrash2,
  FiX,
} from 'react-icons/fi';
import useEscape from '@/hooks/useEscape';
import type { Item, Queue, QueuePowerAction } from '@/types';
import {
  fmtDetailSize,
  fmtEta,
  itemPct,
  statusLabel,
} from '@/lib/format';
import {
  compareQueueFiles,
  defaultOnceDate,
  normalizeOnceDate,
  normalizeQueueMaxConcurrent,
  normalizeQueuePowerAction,
  normalizeRetriesPerFile,
  normalizeScheduleMode,
  normalizeTime24h,
  normalizeWeekdays,
  queuePowerOptions,
  QUEUE_SCHED_DEFAULT_START,
  QUEUE_SCHED_DEFAULT_STOP,
} from '@/lib/schedule';
import { en } from '@/locale/en';
import type { AppStrings } from '@/locale/en';

type Strings = AppStrings;
const enSched = en.scheduler;

/** Active-locale scheduler strings with English fallback (no locale-file churn). */
function schedStrings(t: Strings): AppStrings['scheduler'] {
  try {
    const s = (t as any)?.scheduler;
    if (s && typeof s === 'object' && s.title) return s;
  } catch {}
  return enSched;
}

/**
 * Section headings / microcopy introduced by the redesign.
 * Read from the locale when present, otherwise English — so the 30+
 * existing locale files keep compiling untouched.
 */
function extraCopy(s: AppStrings['scheduler']) {
  const e: any = enSched as any;
  const o: any = s as any;
  return {
    generalTitle: o?.generalTitle || e?.generalTitle || 'General',
    generalSub: o?.generalSub || e?.generalSub || 'Name this queue and choose startup behavior.',
    timingTitle: o?.timingTitle || e?.timingTitle || 'Start schedule',
    timingSub: o?.timingSub || e?.timingSub || 'When should this queue start downloading?',
    stopTitle: o?.stopTitle || e?.stopTitle || 'Stop schedule',
    stopSub: o?.stopSub || e?.stopSub || 'Optionally stop the queue at a fixed time.',
    retryTitle: o?.retryTitle || e?.retryTitle || 'Retries',
    retrySub: o?.retrySub || e?.retrySub || 'How many times should each failed file be retried?',
    finishTitle: o?.finishTitle || e?.finishTitle || 'When finished',
    finishSub: o?.finishSub || e?.finishSub || 'What should happen after every file completes?',
    filesTitle: o?.filesTitle || e?.filesTitle || 'Files in queue',
    unsaved: o?.unsaved || e?.unsaved || 'Unsaved changes',
    savedHint: o?.savedHint || e?.savedHint || 'All changes saved',
    shortcutHint: o?.shortcutHint || e?.shortcutHint || 'Ctrl+S to apply',
  };
}

// ---------------------------------------------------------------------------
// Draft model (unchanged behavior — same queue fields as before)
// ---------------------------------------------------------------------------

export interface SchedulerDraft {
  name: string;
  startOnStartup: boolean;
  startAtEnabled: boolean;
  startTime: string;
  scheduleMode: 'once' | 'daily';
  onceDate: string;
  weekdays: boolean[];
  stopAtEnabled: boolean;
  stopTime: string;
  customRetries: boolean;
  retries: number;
  openEnabled: boolean;
  openPath: string;
  exitWhenDone: boolean;
  powerEnabled: boolean;
  power: QueuePowerAction;
  forceTerminate: boolean;
  maxConcurrent: number;
}

function draftFromQueue(q: Queue): SchedulerDraft {
  const mode = normalizeScheduleMode((q as any)?.scheduleMode);
  return {
    name: String((q as any)?.name || ''),
    startOnStartup: !!((q as any)?.startOnStartup),
    startAtEnabled: (q as any)?.startAtEnabled !== undefined ? !!((q as any).startAtEnabled) : !!(q as any)?.schedulerEnabled,
    startTime: normalizeTime24h((q as any)?.scheduleStart) || QUEUE_SCHED_DEFAULT_START,
    scheduleMode: mode,
    onceDate: normalizeOnceDate((q as any)?.onceDate) || defaultOnceDate(),
    weekdays: normalizeWeekdays((q as any)?.weekdays),
    stopAtEnabled: (q as any)?.stopAtEnabled !== undefined ? !!((q as any).stopAtEnabled) : !!(q as any)?.schedulerEnabled,
    stopTime: normalizeTime24h((q as any)?.scheduleStop) || QUEUE_SCHED_DEFAULT_STOP,
    customRetries: normalizeRetriesPerFile((q as any)?.retriesPerFile) !== null,
    retries: normalizeRetriesPerFile((q as any)?.retriesPerFile) ?? 3,
    openEnabled: !!String((q as any)?.openWhenDone || '').trim(),
    openPath: String((q as any)?.openWhenDone || ''),
    exitWhenDone: !!((q as any)?.exitAppWhenDone),
    powerEnabled: normalizeQueuePowerAction((q as any)?.afterComplete) !== 'nothing',
    power: normalizeQueuePowerAction((q as any)?.afterComplete),
    forceTerminate: !!((q as any)?.forceTerminate),
    maxConcurrent: normalizeQueueMaxConcurrent((q as any)?.maxConcurrent, 1),
  };
}

function draftToPatch(d: SchedulerDraft): Record<string, unknown> {
  return {
    name: d.name.trim(),
    startOnStartup: d.startOnStartup,
    schedulerEnabled: d.startAtEnabled || d.stopAtEnabled,
    startAtEnabled: d.startAtEnabled,
    stopAtEnabled: d.stopAtEnabled,
    scheduleStart: d.startTime,
    scheduleStop: d.stopTime,
    scheduleMode: d.scheduleMode,
    onceDate: d.onceDate,
    weekdays: d.weekdays,
    retriesPerFile: d.customRetries ? Math.min(10, Math.max(0, Math.round(d.retries))) : null,
    openWhenDone: d.openEnabled ? d.openPath.trim() : '',
    exitAppWhenDone: d.exitWhenDone,
    afterComplete: d.powerEnabled ? d.power : 'nothing',
    forceTerminate: d.forceTerminate,
    maxConcurrent: normalizeQueueMaxConcurrent(d.maxConcurrent, 1),
  };
}

function draftsEqual(a: SchedulerDraft, b: SchedulerDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface Props {
  queues: Queue[];
  items: Item[];
  initialQueueId: string;
  t: Strings;
  onClose: () => void;
  onCreateQueue: (name: string) => Promise<Queue | null>;
  onDeleteQueue: (q: Queue) => Promise<void>;
  onSaveQueue: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onReorder: (queueId: string, orderedIds: string[]) => Promise<void>;
  onRemoveItem: (id: string, deleteFile: boolean) => Promise<void>;
  onStartQueue: (q: Queue) => Promise<void>;
  onStopQueue: (q: Queue) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Small presentational building blocks
// ---------------------------------------------------------------------------

function SwitchRow(props: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  sub?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  const { checked, onChange, title, sub, disabled, icon } = props;
  return (
    <label className={'sched-switch-row' + (disabled ? ' is-disabled' : '')}>
      <span className="sched-switch-meta">
        {icon && <span className="sched-switch-icon">{icon}</span>}
        <span className="sched-switch-text">
          <span className="sched-switch-title">{title}</span>
          {sub && <span className="sched-switch-sub">{sub}</span>}
        </span>
      </span>
      <span className={'sched-switch' + (checked ? ' on' : '')} aria-hidden="true">
        <span className="sched-switch-knob" />
      </span>
      <input
        type="checkbox"
        className="sched-switch-input"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function Card(props: { icon: React.ReactNode; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="sched-card">
      <header className="sched-card-head">
        <span className="sched-card-icon">{props.icon}</span>
        <span className="sched-card-titles">
          <span className="sched-card-title">{props.title}</span>
          {props.sub && <span className="sched-card-sub">{props.sub}</span>}
        </span>
      </header>
      <div className="sched-card-body">{props.children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main dialog
// ---------------------------------------------------------------------------

export default function QueueScheduler({
  queues, items, initialQueueId, t, onClose,
  onCreateQueue, onDeleteQueue, onSaveQueue, onReorder, onRemoveItem, onStartQueue, onStopQueue,
}: Props) {
  const s = schedStrings(t);
  const x = extraCopy(s);
  const [selectedId, setSelectedId] = useState<string>(initialQueueId || queues[0]?.id || '');
  const [tab, setTab] = useState<'schedule' | 'files'>('schedule');
  const [drafts, setDrafts] = useState<Record<string, SchedulerDraft>>({});
  const [errors, setErrors] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [fileSel, setFileSel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newError, setNewError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  // In-app unsaved-changes confirmation (replaces window.confirm so the
  // title stays "Jetro" and the body follows the UI direction).
  const [showDiscard, setShowDiscard] = useState(false);

  const selected: Queue | undefined = useMemo(
    () => queues.find((q) => q.id === selectedId) || queues[0],
    [queues, selectedId],
  );
  const selId = selected?.id || '';

  useEscape(!!pendingDelete, () => setPendingDelete(null));

  // Keep selection valid when queues change (create/delete from elsewhere).
  // Drafts of deleted queues are evicted (deletion is confirmed App-side).
  useEffect(() => {
    if (!queues.length) return;
    if (!queues.some((q) => q.id === selectedId)) {
      setSelectedId(queues[0].id);
    }
    setDrafts((prev) => {
      const ids = new Set(queues.map((q) => q.id));
      if (Object.keys(prev).every((k) => ids.has(k))) return prev;
      const next: typeof prev = {};
      for (const k of Object.keys(prev)) if (ids.has(k)) next[k] = prev[k];
      return next;
    });
  }, [queues, selectedId]);

  // Reset file selection when switching queues.
  useEffect(() => {
    setFileSel(null);
    setErrors('');
  }, [selId, tab]);

  const draft: SchedulerDraft | null = useMemo(() => {
    if (!selected) return null;
    if (drafts[selected.id]) return drafts[selected.id];
    return draftFromQueue(selected);
  }, [drafts, selected]);

  const setDraft = (patch: Partial<SchedulerDraft>) => {
    if (!selected || !draft) return;
    setDrafts((prev) => ({ ...prev, [selected.id]: { ...draft, ...patch } }));
    setErrors('');
  };

  const isDirty = useMemo(() => {
    if (!selected || !draft) return false;
    if (drafts[selected.id]) return !draftsEqual(drafts[selected.id], draftFromQueue(selected));
    return false;
  }, [drafts, draft, selected]);

  const queueFiles = useMemo(() => {
    if (!selId) return [];
    return items
      .filter((i) => (i.queueId || null) === selId)
      .sort((a, b) => compareQueueFiles(a as any, b as any));
  }, [items, selId]);

  /** Per-queue file counts for the sidebar badges (no search — direct map). */
  const fileCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) {
      const k = (i.queueId || '') as string;
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [items]);

  const validate = (d: SchedulerDraft): string => {
    if (!d.name.trim()) return t.queueModal.nameEmpty;
    if (d.startAtEnabled && !normalizeTime24h(d.startTime)) return s.timeError;
    if (d.stopAtEnabled && !normalizeTime24h(d.stopTime)) return s.timeError;
    if (d.scheduleMode === 'once' && !normalizeOnceDate(d.onceDate)) return s.dateError;
    return '';
  };

  /** Live per-field errors for inline highlighting (same rules as validate). */
  const fieldErrors = useMemo(() => {
    if (!draft) return { name: '', start: '', stop: '', date: '' };
    return {
      name: !draft.name.trim() ? t.queueModal.nameEmpty : '',
      start: draft.startAtEnabled && !normalizeTime24h(draft.startTime) ? s.timeError : '',
      stop: draft.stopAtEnabled && !normalizeTime24h(draft.stopTime) ? s.timeError : '',
      date: draft.scheduleMode === 'once' && !normalizeOnceDate(draft.onceDate) ? s.dateError : '',
    };
  }, [draft, t, s]);

  const saveDraft = async (d?: SchedulerDraft): Promise<boolean> => {
    if (!selected) return false;
    const cur = d || draft;
    if (!cur) return false;
    const err = validate(cur);
    if (err) {
      setErrors(err);
      return false;
    }
    setErrors('');
    setSaving(true);
    try {
      const patch = draftToPatch(cur);
      // Normalize times through the shared helper so "2:5" becomes "02:05".
      patch.scheduleStart = normalizeTime24h(cur.startTime) || QUEUE_SCHED_DEFAULT_START;
      patch.scheduleStop = normalizeTime24h(cur.stopTime) || QUEUE_SCHED_DEFAULT_STOP;
      await onSaveQueue(selected.id, patch);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[selected.id];
        return next;
      });
      return true;
    } catch (e: any) {
      setErrors(e?.message || s.couldNotSave);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleApply = async () => {
    await saveDraft();
  };

  const handleStartNow = async () => {
    if (!selected) return;
    const ok = await saveDraft();
    if (!ok) return;
    try {
      await onStartQueue(selected);
    } catch {}
  };

  const handleStop = async () => {
    if (!selected) return;
    try {
      // Save schedule edits first so Stop applies to the latest window.
      if (isDirty) await saveDraft();
      await onStopQueue(selected);
    } catch {}
  };

  const handleClose = () => {
    if (showDiscard) {
      setShowDiscard(false);
      return;
    }
    if (pendingDelete) {
      setPendingDelete(null);
      return;
    }
    if (isDirty) {
      setShowDiscard(true);
      return;
    }
    onClose();
  };
  useEscape(true, () => {
    // Delete confirm consumes Escape first (handled above via pendingDelete hook too).
    if (pendingDelete) return;
    handleClose();
  });

  // Ctrl/Cmd+S applies without closing — standard for settings-style dialogs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleApply();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const handleSelectQueue = (id: string) => {
    setSelectedId(id);
    setCreating(false);
    setNewError('');
  };

  const handleCreate = async () => {
    const clean = newName.trim();
    if (!clean) {
      setNewError(t.queueModal.nameEmpty);
      return;
    }
    setNewError('');
    try {
      const q = await onCreateQueue(clean);
      setNewName('');
      setCreating(false);
      if (q?.id) {
        setSelectedId(q.id);
        setTab('schedule');
      }
    } catch (e: any) {
      setNewError(e?.message || s.couldNotSave);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    // Opens the App-level delete confirmation; drafts are evicted by the
    // queues-change effect once the deletion actually lands.
    try {
      await onDeleteQueue(selected);
    } catch {}
  };

  const moveFile = async (dir: -1 | 1) => {
    if (!fileSel || !selId) return;
    const idx = queueFiles.findIndex((f) => f.id === fileSel);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= queueFiles.length) return;
    const next = [...queueFiles];
    const [moved] = next.splice(idx, 1);
    next.splice(j, 0, moved);
    try {
      await onReorder(selId, next.map((f) => f.id));
      setFileSel(moved.id);
    } catch (e: any) {
      setErrors(e?.message || s.couldNotReorder);
    }
  };

  const askDeleteFile = (id: string) => {
    const f = queueFiles.find((x) => x.id === id);
    if (!f) return;
    setPendingDelete({ id, name: f.filename });
  };

  const confirmDeleteFile = async (deleteFile: boolean) => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    try {
      await onRemoveItem(id, deleteFile);
      if (fileSel === id) setFileSel(null);
    } catch {}
  };

  const browseOpenFile = async () => {
    try {
      const f = await (window as any)?.jetro?.pickFile?.();
      if (f && draft) setDraft({ openPath: String(f), openEnabled: true });
    } catch {}
  };

  if (!selected || !draft) {
    return (
      <div className="modal-overlay" onClick={handleClose}>
        <div className="modal sched-modal" onClick={(e) => e.stopPropagation()}>
          <h2>{s.title}</h2>
          <p>{s.noQueue}</p>
          <div className="row sched-footer">
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={handleClose}>{s.close}</button>
          </div>
        </div>
      </div>
    );
  }

  const wd = s.weekdays && s.weekdays.length === 7 ? s.weekdays : enSched.weekdays;
  const running = !!selected.running;
  const selCount = fileCounts.get(selId) || 0;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal sched-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={s.title}>
        {/* ---------- Header ---------- */}
        <div className="sched-head">
          <span className="sched-head-icon"><FiCalendar size={18} /></span>
          <span className="sched-head-text">
            <span className="sched-head-title">{s.title}</span>
            <span className="sched-head-sub">
              <span className="sched-head-qname" title={selected.name}>{selected.name}</span>
              <span className={'sched-pill' + (running ? ' is-running' : ' is-idle')}>
                <span className={'queue-dot' + (running ? ' running' : '')} />
                {running ? t.common.runningBadge : t.common.stoppedBadge}
              </span>
              {isDirty
                ? <span className="sched-pill is-dirty">{x.unsaved}</span>
                : <span className="sched-pill is-clean"><FiCheck size={12} /> {x.savedHint}</span>}
            </span>
          </span>
          <button className="sched-x" onClick={handleClose} title={s.close} aria-label={s.close}>
            <FiX size={17} />
          </button>
        </div>

        <div className="sched-body">
          {/* ---------- Sidebar: queue list (no search per spec) ---------- */}
          <aside className="sched-side">
            <div className="sched-side-label">
              <span>{s.queues}</span>
              <span className="sched-count">{queues.length}</span>
            </div>
            <div className="sched-queue-list" role="listbox" aria-label={s.queues}>
              {queues.map((q) => {
                const active = q.id === selId;
                const n = fileCounts.get(q.id) || 0;
                return (
                  <button
                    key={q.id}
                    role="option"
                    aria-selected={active}
                    className={'sched-queue-item' + (active ? ' active' : '')}
                    onClick={() => handleSelectQueue(q.id)}
                    title={q.name}
                  >
                    <span className={'queue-dot' + (q.running ? ' running' : '')} />
                    <span className="nav-label sched-qname">{q.name}</span>
                    <span className="sched-qcount">{n}</span>
                  </button>
                );
              })}
              {queues.length === 0 && <div className="sched-empty">{s.noQueue}</div>}
            </div>
            {creating ? (
              <div className="sched-create">
                <input
                  className={'input' + (newError ? ' is-invalid' : '')}
                  autoFocus
                  dir="auto"
                  value={newName}
                  placeholder={t.queueModal.namePlaceholder}
                  aria-invalid={!!newError}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    if (e.target.value.trim()) setNewError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newName.trim()) void handleCreate();
                    if (e.key === 'Escape') {
                      setCreating(false);
                      setNewName('');
                      setNewError('');
                    }
                  }}
                />
                {newError && <div className="form-error">{newError}</div>}
                <div className="row">
                  <button className="btn btn-primary sched-grow" onClick={handleCreate} disabled={!newName.trim()}>
                    {t.queueModal.create}
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      setCreating(false);
                      setNewName('');
                      setNewError('');
                    }}
                  >
                    {t.common.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <div className="row sched-side-actions">
                <button
                  className="btn sched-grow"
                  onClick={() => {
                    setCreating(true);
                    setNewError('');
                  }}
                >
                  <FiPlus size={14} /> {s.newQueue}
                </button>
                <button
                  className="btn btn-danger sched-icon"
                  onClick={handleDelete}
                  disabled={!selected}
                  title={s.deleteQueue}
                  aria-label={s.deleteQueue}
                >
                  <FiTrash2 size={14} />
                </button>
              </div>
            )}
          </aside>

          {/* ---------- Main column ---------- */}
          <div className="sched-main">
            <div className="sched-tabs" role="tablist" aria-label={s.title}>
              <button
                role="tab"
                aria-selected={tab === 'schedule'}
                className={'sched-tab' + (tab === 'schedule' ? ' active' : '')}
                onClick={() => setTab('schedule')}
              >
                <FiClock size={14} /> {s.scheduleTab}
              </button>
              <button
                role="tab"
                aria-selected={tab === 'files'}
                className={'sched-tab' + (tab === 'files' ? ' active' : '')}
                onClick={() => setTab('files')}
              >
                <FiFolder size={14} /> {s.filesTab}
                <span className="sched-tab-count">{selCount}</span>
              </button>
            </div>

            {tab === 'schedule' ? (
              <div className="sched-scroll" role="tabpanel">
                <Card icon={<FiFolder size={15} />} title={x.generalTitle} sub={x.generalSub}>
                  <label className="sched-field">
                    <span className="sched-label">{s.queueNameLabel}</span>
                    <input
                      className={'input' + (fieldErrors.name ? ' is-invalid' : '')}
                      dir="auto"
                      value={draft.name}
                      aria-invalid={!!fieldErrors.name}
                      onChange={(e) => setDraft({ name: e.target.value })}
                      placeholder={t.queueModal.namePlaceholder}
                    />
                    {fieldErrors.name && <span className="sched-field-error">{fieldErrors.name}</span>}
                  </label>
                  <SwitchRow
                    checked={draft.startOnStartup}
                    onChange={(v) => setDraft({ startOnStartup: v })}
                    title={s.startOnStartup}
                    icon={<FiPlay size={14} />}
                  />
                </Card>

                <Card icon={<FiClock size={15} />} title={x.timingTitle} sub={x.timingSub}>
                  <SwitchRow
                    checked={draft.startAtEnabled}
                    onChange={(v) => setDraft({ startAtEnabled: v })}
                    title={s.startAt}
                    icon={<FiClock size={14} />}
                  />
                  <div className={'sched-nest' + (draft.startAtEnabled ? '' : ' is-off')}>
                    <div className="sched-row">
                      <input
                        className={'input sched-time' + (fieldErrors.start ? ' is-invalid' : '')}
                        type="time"
                        dir="ltr"
                        value={draft.startTime}
                        disabled={!draft.startAtEnabled}
                        aria-invalid={!!fieldErrors.start}
                        onChange={(e) => setDraft({ startTime: e.target.value })}
                      />
                      <div className="sched-segment" role="radiogroup" aria-label={s.startAt}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={draft.scheduleMode === 'once'}
                          className={'sched-seg-btn' + (draft.scheduleMode === 'once' ? ' active' : '')}
                          disabled={!draft.startAtEnabled}
                          onClick={() => setDraft({ scheduleMode: 'once' })}
                        >
                          {s.onceAt}
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={draft.scheduleMode === 'daily'}
                          className={'sched-seg-btn' + (draft.scheduleMode === 'daily' ? ' active' : '')}
                          disabled={!draft.startAtEnabled}
                          onClick={() => setDraft({ scheduleMode: 'daily' })}
                        >
                          {s.daily}
                        </button>
                      </div>
                    </div>
                    {fieldErrors.start && <span className="sched-field-error">{fieldErrors.start}</span>}
                    {draft.scheduleMode === 'once' ? (
                      <div>
                        <input
                          className={'input sched-date' + (fieldErrors.date ? ' is-invalid' : '')}
                          type="date"
                          dir="ltr"
                          value={draft.onceDate}
                          disabled={!draft.startAtEnabled}
                          aria-invalid={!!fieldErrors.date}
                          onChange={(e) => setDraft({ onceDate: e.target.value })}
                        />
                        {fieldErrors.date && <span className="sched-field-error">{fieldErrors.date}</span>}
                      </div>
                    ) : (
                      <div className="sched-chips" role="group" aria-label={s.daily}>
                        {wd.map((label, i) => {
                          const on = !!draft.weekdays[i];
                          return (
                            <label
                              key={i}
                              className={'sched-chip' + (on ? ' on' : '') + (!draft.startAtEnabled ? ' is-off' : '')}
                            >
                              <input
                                type="checkbox"
                                className="sched-chip-input"
                                checked={on}
                                disabled={!draft.startAtEnabled}
                                onChange={(e) => {
                                  const next = [...draft.weekdays];
                                  next[i] = e.target.checked;
                                  setDraft({ weekdays: next });
                                }}
                              />
                              {label}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </Card>

                <Card icon={<FiSquare size={15} />} title={x.stopTitle} sub={x.stopSub}>
                  <div className={'sched-stop-inline' + (draft.stopAtEnabled ? '' : ' is-off')}>
                    <button
                      type="button"
                      className="sched-stop-meta"
                      onClick={() => setDraft({ stopAtEnabled: !draft.stopAtEnabled })}
                      aria-label={s.stopAt}
                      title={s.stopAt}
                    >
                      <span className="sched-switch-icon"><FiSquare size={14} /></span>
                      <span className="sched-switch-title">{s.stopAt}</span>
                    </button>
                    <input
                      className={'input sched-time sched-time-sm' + (fieldErrors.stop ? ' is-invalid' : '')}
                      type="time"
                      dir="ltr"
                      value={draft.stopTime}
                      disabled={!draft.stopAtEnabled}
                      aria-invalid={!!fieldErrors.stop}
                      aria-label={s.stopAt}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setDraft({ stopTime: e.target.value })}
                    />
                    <button
                      type="button"
                      role="switch"
                      aria-checked={draft.stopAtEnabled}
                      aria-label={s.stopAt}
                      title={s.stopAt}
                      className={'sched-switch sched-stop-toggle' + (draft.stopAtEnabled ? ' on' : '')}
                      onClick={() => setDraft({ stopAtEnabled: !draft.stopAtEnabled })}
                    >
                      <span className="sched-switch-knob" />
                    </button>
                    <input
                      type="checkbox"
                      className="sched-switch-input"
                      checked={draft.stopAtEnabled}
                      onChange={(e) => setDraft({ stopAtEnabled: e.target.checked })}
                      aria-label={s.stopAt}
                      tabIndex={-1}
                    />
                  </div>
                  {fieldErrors.stop && <span className="sched-field-error">{fieldErrors.stop}</span>}
                </Card>

                <Card icon={<FiRefreshCw size={15} />} title={x.retryTitle} sub={x.retrySub}>
                  <SwitchRow
                    checked={draft.customRetries}
                    onChange={(v) => setDraft({ customRetries: v })}
                    title={s.retries}
                  />
                  <div className={'sched-row' + (draft.customRetries ? '' : ' is-off')}>
                    <div className="sched-stepper">
                      <button
                        type="button"
                        className="btn sched-step-btn"
                        disabled={!draft.customRetries || draft.retries <= 0}
                        onClick={() => setDraft({ retries: Math.max(0, draft.retries - 1) })}
                        aria-label="−"
                      >
                        −
                      </button>
                      <input
                        className="input sched-step-val"
                        type="number"
                        dir="ltr"
                        min={0}
                        max={10}
                        value={draft.retries}
                        disabled={!draft.customRetries}
                        onChange={(e) => setDraft({ retries: Math.min(10, Math.max(0, Math.round(Number(e.target.value) || 0))) })}
                      />
                      <button
                        type="button"
                        className="btn sched-step-btn"
                        disabled={!draft.customRetries || draft.retries >= 10}
                        onClick={() => setDraft({ retries: Math.min(10, draft.retries + 1) })}
                        aria-label="+"
                      >
                        +
                      </button>
                    </div>
                    {!draft.customRetries && <span className="form-hint sched-hint-inline">{s.useGlobalRetries}</span>}
                  </div>
                </Card>

                <Card icon={<FiPower size={15} />} title={x.finishTitle} sub={x.finishSub}>
                  <SwitchRow
                    checked={draft.openEnabled}
                    onChange={(v) => setDraft({ openEnabled: v })}
                    title={s.openWhenDone}
                    icon={<FiFolder size={14} />}
                  />
                  <div className={'row dir-row' + (draft.openEnabled ? '' : ' is-off')}>
                    <input
                      className="input"
                      dir="ltr"
                      value={draft.openPath}
                      disabled={!draft.openEnabled}
                      placeholder="C:\path\to\file"
                      onChange={(e) => setDraft({ openPath: e.target.value })}
                    />
                    <button className="btn" disabled={!draft.openEnabled} title={s.openWhenDoneBrowse} onClick={browseOpenFile}>
                      …
                    </button>
                  </div>
                  <SwitchRow
                    checked={draft.exitWhenDone}
                    onChange={(v) => setDraft({ exitWhenDone: v })}
                    title={s.exitWhenDone}
                    icon={<FiX size={14} />}
                  />
                  <SwitchRow
                    checked={draft.powerEnabled}
                    onChange={(v) => setDraft({ powerEnabled: v })}
                    title={s.powerLabel}
                    icon={<FiPower size={14} />}
                  />
                  <div className={'sched-nest' + (draft.powerEnabled ? '' : ' is-off')}>
                    <select
                      className="input select-single"
                      value={draft.powerEnabled ? draft.power : 'shutdown'}
                      disabled={!draft.powerEnabled}
                      onChange={(e) => setDraft({ power: normalizeQueuePowerAction(e.target.value) })}
                    >
                      {queuePowerOptions(t.power)
                        .filter((o) => o.value !== 'nothing')
                        .map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </select>
                    <label className={'sched-checkline' + (draft.powerEnabled ? '' : ' is-off')}>
                      <input
                        type="checkbox"
                        checked={draft.forceTerminate}
                        disabled={!draft.powerEnabled}
                        onChange={(e) => setDraft({ forceTerminate: e.target.checked })}
                      />
                      {s.forceTerminate}
                    </label>
                    <div className="form-hint sched-hint">{s.powerHint}</div>
                  </div>
                </Card>

                {errors && <div className="form-error sched-error">{errors}</div>}
              </div>
            ) : (
              <div className="sched-scroll sched-files-col" role="tabpanel">
                <section className="sched-card sched-conc-card">
                  <span className="sched-conc-text">{s.simultaneousPrefix}</span>
                  <div className="sched-stepper sched-stepper-sm">
                    <button
                      type="button"
                      className="btn sched-step-btn"
                      disabled={draft.maxConcurrent <= 1}
                      onClick={() => setDraft({ maxConcurrent: normalizeQueueMaxConcurrent(draft.maxConcurrent - 1, 1) })}
                      aria-label="−"
                    >
                      −
                    </button>
                    <input
                      className="input sched-step-val"
                      type="number"
                      dir="ltr"
                      min={1}
                      max={10}
                      value={draft.maxConcurrent}
                      onChange={(e) => setDraft({ maxConcurrent: normalizeQueueMaxConcurrent(e.target.value, 1) })}
                    />
                    <button
                      type="button"
                      className="btn sched-step-btn"
                      disabled={draft.maxConcurrent >= 10}
                      onClick={() => setDraft({ maxConcurrent: normalizeQueueMaxConcurrent(draft.maxConcurrent + 1, 1) })}
                      aria-label="+"
                    >
                      +
                    </button>
                  </div>
                  <span className="sched-conc-text">{s.simultaneousSuffix}</span>
                </section>

                <section className="sched-card sched-files-card">
                  <header className="sched-files-head">
                    <span className="sched-card-title">{x.filesTitle}</span>
                    <span className="sched-count">{queueFiles.length}</span>
                  </header>
                  <div className="sched-table-wrap">
                    <table className="sched-table">
                      <thead>
                        <tr>
                          <th>{s.colName}</th>
                          <th className="num">{s.colSize}</th>
                          <th>{s.colStatus}</th>
                          <th className="num">{s.colEta}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {queueFiles.map((f) => {
                          const pct = itemPct(f as any);
                          const active = fileSel === f.id;
                          const done = f.status === 'completed';
                          return (
                            <tr
                              key={f.id}
                              className={active ? 'active' : ''}
                              onClick={() => setFileSel(active ? null : f.id)}
                            >
                              <td title={`${f.filename}\n${(f as any).savePath || ''}`}>
                                <span className="sched-fname">{f.filename}</span>
                                {!done && (
                                  <span className="sched-progress" aria-hidden="true">
                                    <span className="sched-progress-bar" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                                  </span>
                                )}
                              </td>
                              <td className="num">{fmtDetailSize(f as any)}</td>
                              <td>
                                {done
                                  ? statusLabel(f.status, t.status)
                                  : `${statusLabel(f.status, t.status)} ${pct.toFixed(2)}%`}
                              </td>
                              <td className="num">{fmtEta(f as any)}</td>
                            </tr>
                          );
                        })}
                        {queueFiles.length === 0 && (
                          <tr className="empty-row">
                            <td colSpan={4}>{s.emptyFiles}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="row sched-file-actions">
                    <button
                      className="btn sched-icon-btn"
                      title={s.moveDown}
                      aria-label={s.moveDown}
                      disabled={!fileSel || queueFiles.findIndex((f) => f.id === fileSel) >= queueFiles.length - 1}
                      onClick={() => moveFile(1)}
                    >
                      <FiArrowDown size={15} />
                    </button>
                    <button
                      className="btn sched-icon-btn"
                      title={s.moveUp}
                      aria-label={s.moveUp}
                      disabled={!fileSel || queueFiles.findIndex((f) => f.id === fileSel) <= 0}
                      onClick={() => moveFile(-1)}
                    >
                      <FiArrowUp size={15} />
                    </button>
                    <button
                      className="btn sched-icon-btn danger"
                      title={s.removeFromQueue}
                      aria-label={s.removeFromQueue}
                      disabled={!fileSel}
                      onClick={() => fileSel && askDeleteFile(fileSel)}
                    >
                      <FiX size={15} />
                    </button>
                  </div>
                </section>
                {errors && <div className="form-error sched-error">{errors}</div>}
              </div>
            )}

            {/* ---------- Footer ---------- */}
            <div className="sched-footer">
              <div className="sched-footer-left">
                <button className={'btn' + (running ? '' : ' btn-primary')} onClick={handleStartNow} disabled={saving || !selected}>
                  <FiPlay size={14} /> {s.startNow}
                </button>
                <button className="btn" onClick={handleStop} disabled={!selected}>
                  <FiSquare size={14} /> {s.stop}
                </button>
              </div>
              <div className="sched-footer-right">
                <span className="sched-footer-hint" title={x.shortcutHint}>
                  {isDirty ? x.unsaved : ''}
                </span>
                <button className={'btn' + (isDirty ? ' btn-primary' : '')} onClick={handleApply} disabled={saving || !isDirty}>
                  {saving ? <FiRefreshCw size={14} className="spin" /> : isDirty ? <span className="sched-dirty-dot" /> : null}
                  {s.apply}
                </button>
                <button className="btn" onClick={handleClose}>
                  {s.close}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {pendingDelete && (
        <div className="modal-overlay" onClick={() => setPendingDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{s.removeFromQueue}</h2>
            <p>{s.deleteFileConfirm(pendingDelete.name)}</p>
            <p style={{ marginTop: -8 }}>{s.deleteFileBody}</p>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn-danger" onClick={() => confirmDeleteFile(true)}>
                {s.deleteFileButton}
              </button>
              <button className="btn" onClick={() => confirmDeleteFile(false)}>
                {s.keepFileButton}
              </button>
              <button className="btn" onClick={() => setPendingDelete(null)}>
                {t.common.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDiscard && (
        <div className="modal-overlay" style={{ zIndex: 80 }} onClick={() => setShowDiscard(false)}>
          <div className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">{t.discard.title}</h2>
            <p>{t.discard.body}</p>
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn" autoFocus onClick={() => setShowDiscard(false)}>{t.discard.keep}</button>
              <button className="btn btn-danger" onClick={onClose}>{t.discard.discard}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
