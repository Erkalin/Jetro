import { FiInfo } from 'react-icons/fi';

interface NoticeDialogProps {
  message: string;
  okLabel: string;
  onClose: () => void;
}

// In-app alert, follows UI direction.
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
