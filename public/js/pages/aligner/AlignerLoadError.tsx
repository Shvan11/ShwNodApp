/**
 * A failed aligner read, said as such, with Retry. The lists used to fall through
 * to their empty state — "0 patients · No patients with aligner sets", or the
 * search intro — so a network or server failure looked like a clinic with no data
 * (FE-F18-6). AllSetsList already did this right; the other lists share this.
 */
import styles from './AlignerLoadError.module.css';

interface AlignerLoadErrorProps {
    /** What failed to load, e.g. "the doctors". */
    what: string;
    message: string;
    onRetry: () => void;
}

export default function AlignerLoadError({ what, message, onRetry }: AlignerLoadErrorProps) {
    return (
        <div className={styles.box} role="alert">
            <i className="fas fa-exclamation-triangle" aria-hidden="true"></i>
            <h3>Could not load {what}</h3>
            <p>{message}</p>
            <button type="button" className="btn btn-primary" onClick={onRetry}>
                <i className="fas fa-redo" aria-hidden="true"></i> Retry
            </button>
        </div>
    );
}
