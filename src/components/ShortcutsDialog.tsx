import { FiX } from 'react-icons/fi';
import { APP_SHORTCUTS, resolveShortcut } from '@/lib/shortcuts';
import { useLanguage } from '@/locale/LanguageContext';
import useEscape from '@/hooks/useEscape';

interface Props {
  onClose: () => void;
}

export default function ShortcutsDialog({ onClose }: Props) {
  const { t } = useLanguage();
  useEscape(true, onClose);
  return (
    <div className="modal-overlay" style={{ zIndex: 90 }} onClick={onClose}>
      <div
        className="modal shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t.shortcuts.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcuts-head">
          <h2 className="modal-title" style={{ margin: 0 }}>
            {t.shortcuts.title}
          </h2>
          <button className="icon-btn" title={t.shortcuts.closeTitle} aria-label={t.common.close} onClick={onClose}>
            <FiX size={16} />
          </button>
        </div>
        <p className="settings-section-sub" style={{ marginTop: 4 }}>
          {t.shortcuts.note}
        </p>
        <div className="shortcuts-grid">
          {APP_SHORTCUTS.map((s) => {
            const localized = resolveShortcut(t.shortcuts.items, s);
            return (
              <div className="shortcuts-row" key={s.id} title={localized.hint}>
                <span className="shortcuts-label">{localized.label}</span>
                <kbd className="shortcuts-keys">{s.keys}</kbd>
              </div>
            );
          })}
        </div>
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" autoFocus onClick={onClose}>
            {t.common.close}
          </button>
        </div>
      </div>
    </div>
  );
}
