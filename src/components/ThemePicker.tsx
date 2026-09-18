import { useRef, useState } from 'react';
import { FiCheck, FiChevronDown } from 'react-icons/fi';
import { THEME_IDS, getThemeDef } from '@/lib/themes';
import type { ThemeId } from '@/types';
import useEscape from '@/hooks/useEscape';
import useExclusiveDropdown, { notifyDropdownOpened, useDismissOnOutsideClick } from '@/hooks/useExclusiveDropdown';

interface ThemePickerProps {
  value: ThemeId;
  onChange: (id: ThemeId) => void;
  getLabel: (id: ThemeId) => string;
}

function PaletteDots({ id, size = 14 }: { id: ThemeId; size?: number }) {
  const def = getThemeDef(id);
  return (
    <span className="theme-dots" aria-hidden="true">
      {def.palette.map((c) => (
        <span key={c} className="theme-dot" style={{ background: c, width: size, height: size }} />
      ))}
    </span>
  );
}

/** Settings → App theme dropdown: each row shows palette dots + name. */
export default function ThemePicker({ value, onChange, getLabel }: ThemePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEscape(open, () => setOpen(false));
  useExclusiveDropdown('theme-picker', open, () => setOpen(false));
  useDismissOnOutsideClick(rootRef, open, () => setOpen(false));

  const toggle = () => {
    // Close any previously open dropdown before showing this one.
    if (!open) notifyDropdownOpened('theme-picker');
    setOpen((o) => !o);
  };

  return (
    <div className="theme-picker" ref={rootRef}>
      <button
        type="button"
        className="input theme-picker-btn"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <PaletteDots id={value} />
        <span className="theme-picker-name">{getLabel(value)}</span>
        <FiChevronDown size={15} className="theme-picker-chevron" />
      </button>
      {open && (
          <div className="theme-picker-menu" role="listbox">
            {THEME_IDS.map((id) => {
              const active = id === value;
              return (
                <button
                  key={id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={'ctx-item theme-option' + (active ? ' active' : '')}
                  onClick={() => {
                    onChange(id);
                    setOpen(false);
                  }}
                >
                  <PaletteDots id={id} size={13} />
                  <span className="theme-option-name">{getLabel(id)}</span>
                  {active && <FiCheck size={14} className="theme-option-check" />}
                </button>
              );
            })}
          </div>
      )}
    </div>
  );
}
