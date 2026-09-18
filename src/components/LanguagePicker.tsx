import { useRef, useState } from 'react';
import { FiCheck, FiChevronDown, FiGlobe } from 'react-icons/fi';
import { LANGUAGES, PINNED_LANGUAGES } from '@/locale/languages';
import type { Language } from '@/locale/languages';
import FlagIcon from '@/components/FlagIcon';
import useEscape from '@/hooks/useEscape';
import useExclusiveDropdown, { notifyDropdownOpened, useDismissOnOutsideClick } from '@/hooks/useExclusiveDropdown';

interface LanguagePickerProps {
  value: Language;
  onChange: (code: Language) => void;
  label: string;
}

/** Settings → App language dropdown: flag + native name, EN/FA pinned first. */
export default function LanguagePicker({ value, onChange, label }: LanguagePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEscape(open, () => setOpen(false));
  useExclusiveDropdown('language-picker', open, () => setOpen(false));
  useDismissOnOutsideClick(rootRef, open, () => setOpen(false));

  const active = LANGUAGES.find((l) => l.code === value) || LANGUAGES[0];
  const pinned = LANGUAGES.filter((l) => PINNED_LANGUAGES.includes(l.code));
  const rest = LANGUAGES.filter((l) => !PINNED_LANGUAGES.includes(l.code));

  const pick = (code: Language) => {
    onChange(code);
    setOpen(false);
  };

  return (
    <div className="theme-picker lang-picker" ref={rootRef}>
      <button
        type="button"
        className="input theme-picker-btn"
        onClick={() => {
          // Close any previously open dropdown before showing this one.
          if (!open) notifyDropdownOpened('language-picker');
          setOpen((o) => !o);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        title={active.englishName}
      >
        <FlagIcon country={active.country} name={active.englishName} />
        <span className="theme-picker-name">{active.nativeName}</span>
        <FiGlobe size={14} className="theme-picker-chevron" aria-hidden="true" />
        <FiChevronDown size={15} className="theme-picker-chevron" />
      </button>
      {open && (
          <div className="theme-picker-menu" role="listbox" aria-label={label}>
            {pinned.map((l) => {
              const isActive = l.code === value;
              return (
                <button
                  key={l.code}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={'ctx-item theme-option' + (isActive ? ' active' : '')}
                  onClick={() => pick(l.code)}
                  title={l.englishName}
                >
                  <FlagIcon country={l.country} name={l.englishName} />
                  <span className="theme-option-name">{l.nativeName}</span>
                  <span className="lang-picker-sub">{l.englishName}</span>
                  {isActive && <FiCheck size={14} className="theme-option-check" />}
                </button>
              );
            })}
            <div className="ctx-sep" role="separator" />
            {rest.map((l) => {
              const isActive = l.code === value;
              return (
                <button
                  key={l.code}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={'ctx-item theme-option' + (isActive ? ' active' : '')}
                  onClick={() => pick(l.code)}
                  title={l.englishName}
                >
                  <FlagIcon country={l.country} name={l.englishName} />
                  <span className="theme-option-name">{l.nativeName}</span>
                  <span className="lang-picker-sub">{l.englishName}</span>
                  {isActive && <FiCheck size={14} className="theme-option-check" />}
                </button>
              );
            })}
          </div>
      )}
    </div>
  );
}
