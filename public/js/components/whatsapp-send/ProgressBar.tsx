/**
 * Progress Bar Component
 * Shows message sending progress
 */

export interface SendingProgress {
  started: boolean;
  finished: boolean;
  total: number;
  sent: number;
  failed: number;
}

interface ProgressBarProps {
  sendingProgress: SendingProgress;
}

export default function ProgressBar({ sendingProgress }: ProgressBarProps) {
  const { started, finished, total, sent } = sendingProgress;

  if (!started || finished || total === 0) {
    return null;
  }

  const percentage = Math.min((sent / total) * 100, 100);

  return (
    <div
      id="progressContainer"
      className="sending-progress-container"
      role="progressbar"
      aria-label="Message sending progress"
      aria-valuenow={sent}
      aria-valuemin={0}
      aria-valuemax={total}
    >
      <div className="sending-progress-header">
        <span className="sending-progress-title">Sending Messages</span>
        <span id="progressStats" className="sending-progress-stats">
          {sent}/{total}
        </span>
      </div>
      <div className="sending-progress-bar-container">
        <div
          id="progressBarFill"
          className="sending-progress-bar-fill"
          style={{ width: `${percentage}%` }}
        ></div>
      </div>
      <div id="progressText" className="sending-progress-text">
        {sent} of {total} messages delivered
      </div>
    </div>
  );
}
