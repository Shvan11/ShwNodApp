/**
 * Native Dolphin-style photo layout manager (Phase 4). Drag originals from the
 * Sequence Files sidebar into the 8 view slots, frame each, then Save — the
 * server (sharp) renders working/{pid}0{tp}.iNN so the existing grid lights up.
 *
 * Mounted (flag-gated) by ContentRenderer. The feature flag is checked there; if
 * personId is missing we render a notice.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './PhotoEditor.module.css';
import SlotGrid from './SlotGrid';
import SequenceSidebar from './SequenceSidebar';
import { usePhotoEditorState } from './usePhotoEditorState';
import { VIEW_CODES, VIEW_OUTPUT, type PhotoViewCode, type SlotRenderSpec } from './photoEditorTypes';
import { useToast } from '../../../contexts/ToastContext';

interface Props {
  personId?: number | null;
  tpCode: string;
  tpName: string;
  tpDate: string; // YYYY-MM-DD
}

/** {tpName}_{DD-MM-YYYY} — the originals folder convention on the share. */
function folderName(tpName: string, tpDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(tpDate);
  if (!m) return tpName;
  return `${tpName}_${m[3]}-${m[2]}-${m[1]}`;
}

const PhotoEditor = ({ personId, tpCode, tpName, tpDate }: Props) => {
  const toast = useToast();
  const navigate = useNavigate();
  const editor = usePhotoEditorState();
  const [activeView, setActiveView] = useState<PhotoViewCode | null>(null);
  const [saving, setSaving] = useState(false);

  if (!personId) {
    return <div className={styles.notice}>No patient selected.</div>;
  }

  const placedCount = VIEW_CODES.filter((v) => editor.slots[v].sourceRelPath).length;

  const handleSave = async (): Promise<void> => {
    const slots: SlotRenderSpec[] = [];
    for (const view of VIEW_CODES) {
      const s = editor.slots[view];
      if (!s.sourceRelPath) continue;
      const a = s.croppedAreaPixels;
      slots.push({
        view,
        sourceRelPath: s.sourceRelPath,
        flipH: s.flipH,
        flipV: s.flipV,
        rotation: s.rotation,
        output: VIEW_OUTPUT[view],
        // Omitted when the slot was never opened — the server centre-crops to the
        // view aspect in that case.
        ...(a ? { extract: { left: a.x, top: a.y, width: a.width, height: a.height } } : {}),
      });
    }
    if (slots.length === 0) {
      toast.warning('Drop at least one photo into a slot first.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/photo-editor/${personId}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tpName, tpDate, slots }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Render failed');
      }
      const written: string[] = json.data?.written || [];
      const warnings: string[] = json.data?.warnings || [];
      if (written.length) toast.success(`Saved ${written.length} photo(s).`);
      if (warnings.length) toast.warning(`${warnings.length} slot(s) had issues.`);
      navigate(`/patient/${personId}/photos/tp${tpCode}`);
    } catch (err) {
      toast.error(`Save failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.editor}>
      <header className={styles.topbar}>
        <div className={styles.titleBlock}>
          <span className={styles.tpName}>{tpName || 'Timepoint'}</span>
          {tpDate && <span className={styles.tpDate}>{tpDate}</span>}
          <span className={styles.count}>{placedCount}/8 placed</span>
        </div>
        <button
          type="button"
          className={styles.saveBtn}
          disabled={saving || placedCount === 0}
          onClick={handleSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>
      <div className={styles.body}>
        <main className={styles.gridArea}>
          <SlotGrid personId={personId} editor={editor} activeView={activeView} onActivate={setActiveView} />
        </main>
        <SequenceSidebar personId={personId} defaultFolder={folderName(tpName, tpDate)} />
      </div>
    </div>
  );
};

export default PhotoEditor;
