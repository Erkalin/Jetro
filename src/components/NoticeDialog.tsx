import { FiInfo } from 'react-icons/fi';

interface NoticeDialogProps {
  /** Body text — follows the UI direction (RTL in RTL languages). */
  message: string;
  okLabel: string;
  onClose: () => void;
}

// In-app replacement for window.alert(): native popups are titled with the
// lowercase package name and always render LTR. This one is titled "Jetro"
// and inherits <html dir>, so the description is RTL in RTL languages.
export default function NoticeDialog({ message, okLabel, onClose }: NoticeDialogProps) {
  return (
    <div className="modal-overlay" style={{ zIndex: 80 }} onClick={onClose}>
      <div className="modal" style={{ width: 440 }} onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title"><FiInfo className="inline-icon" /> Jetro</h2>
        <p>{message}</p>
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" autoFocus onClick={onClose}>{okLabel}</button>
        </div>
      </div>
    </div>
  );
}
