import { useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import { useToast } from '../../contexts/ToastContext';
import { useLookupManager } from '../../hooks/useLookupManager';
import { putJSON, httpErrorMessage } from '@/core/http';
import { workKeywordsQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import * as workContract from '@shared/contracts/work.contract';
import type { Work } from './WorkCard';
import styles from './WorkKeywordsModal.module.css';

/** A work holds up to five keywords, in the columns `keyword_id_1` … `keyword_id_5`. */
const SLOTS = [1, 2, 3, 4, 5] as const;
type SlotNumber = (typeof SLOTS)[number];

const slotIds = (work: Work): (number | null)[] => SLOTS.map((n) => work[`keyword_id_${n}`]);

interface WorkKeywordsModalProps {
    work: Work;
    onClose: () => void;
    /** Saved: the caller refreshes the works list and toasts. */
    onSaved: (outcome: 'applied' | 'pending') => void;
}

/**
 * The keywords of one work, opened from its card's ⋮ menu: the assigned ones as
 * removable tags, and one list to add another. Right-clicking that list edits the
 * keyword vocabulary in place, or opens it in Settings → Lookups.
 *
 * Each keyword keeps its column: an added one takes the first empty slot and a removed
 * one empties its own, and Save sends only the columns that changed. A save that sent
 * all five would put back a keyword a colleague changed meanwhile (the reason the edit
 * form sends a diff too: `utils/workUpdatePayload.ts`).
 */
const WorkKeywordsModal = ({ work, onClose, onSaved }: WorkKeywordsModalProps) => {
    const { t } = useTranslation('works');
    const toast = useToast();
    const selectId = useId();
    const selectRef = useRef<HTMLSelectElement | null>(null);
    const [baseline] = useState(() => slotIds(work));
    const [slots, setSlots] = useState(baseline);
    const [saving, setSaving] = useState(false);

    const { data: keywordRows, isLoading } = useQuery(workKeywordsQuery());
    const keywords = keywordRows ?? [];

    // A rename here shows on the card's tags too, which come with the works list.
    const lookup = useLookupManager({
        tableKey: 'tblKeyWord',
        invalidateKeys: [qk.lookups.workKeywords(), qk.patient.works(work.person_id)],
    });

    const changed = slots.some((id, i) => id !== baseline[i]);
    const full = slots.every((id) => id != null);
    const available = keywords.filter((k) => !slots.includes(k.id));

    const nameOf = (id: number, slotIndex: number): string => {
        const row = keywords.find((k) => k.id === id);
        if (row?.key_word) return row.key_word;
        // Before the list arrives, the works row already carries the names it was read with.
        if (baseline[slotIndex] === id) {
            const joined = work[`Keyword${(slotIndex + 1) as SlotNumber}`];
            if (joined) return joined;
        }
        return t('keywords.unnamed', { id });
    };

    const add = (value: string): void => {
        const id = Number(value);
        if (!value || Number.isNaN(id)) return;
        const free = slots.indexOf(null);
        if (free === -1 || slots.includes(id)) return;
        setSlots(slots.map((s, i) => (i === free ? id : s)));
    };

    const removeAt = (slotIndex: number): void => {
        setSlots(slots.map((s, i) => (i === slotIndex ? null : s)));
        // The removed tag's button is gone; the list is where the next action is.
        selectRef.current?.focus();
    };

    const save = async (): Promise<void> => {
        const body: Record<string, number | null> = {};
        SLOTS.forEach((n, i) => {
            if (slots[i] !== baseline[i]) body[`keyword_id_${n}`] = slots[i];
        });
        if (Object.keys(body).length === 0) {
            onClose();
            return;
        }
        setSaving(true);
        try {
            const result = await putJSON<{ outcome: 'applied' | 'pending' }>(
                '/api/updatework',
                { workId: work.work_id, ...body },
                { schema: workContract.updateWork.response }
            );
            onSaved(result.outcome);
        } catch (err) {
            toast.error(httpErrorMessage(err, t('keywords.failed')), 5000);
            setSaving(false);
        }
    };

    const assigned = slots.filter((id) => id != null).length;

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            contentClassName={styles.modalContent}
            ariaLabelledBy="work-keywords-modal-title"
            initialFocusRef={selectRef}
            unsavedGuard={{ isDirty: changed && !saving }}
        >
            {(dismiss) => (
                <>
                    <ModalHeader
                        titleId="work-keywords-modal-title"
                        title={t('keywords.title')}
                        subtitle={work.type_name || t('card.otherTreatment')}
                        icon={<i className="fas fa-tags" aria-hidden="true" />}
                        onClose={dismiss}
                    />

                    <div className={styles.modalBody}>
                        {assigned === 0 ? (
                            <p className={styles.empty}>{t('keywords.none')}</p>
                        ) : (
                            <ul className={styles.tags} aria-label={t('keywords.assigned')}>
                                {slots.map((id, i) => {
                                    if (id == null) return null;
                                    const name = nameOf(id, i);
                                    return (
                                        <li key={SLOTS[i]} className={styles.tag}>
                                            <span>{name}</span>
                                            <button
                                                type="button"
                                                className={styles.tagRemove}
                                                onClick={() => removeAt(i)}
                                                aria-label={t('keywords.remove', { name })}
                                                title={t('keywords.remove', { name })}
                                            >
                                                <i className="fas fa-times" aria-hidden="true"></i>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}

                        <label className={styles.addLabel} htmlFor={selectId}>
                            {t('keywords.add')}
                            <span className={styles.count}>{t('keywords.count', { n: assigned, max: SLOTS.length })}</span>
                        </label>
                        {/* Never `disabled` when full: a disabled control gets no right-click,
                            and editing the vocabulary is still wanted then. */}
                        <select
                            id={selectId}
                            ref={selectRef}
                            className={styles.select}
                            value=""
                            onChange={(e) => add(e.target.value)}
                            onContextMenu={lookup.onContextMenu}
                            title={lookup.canManage ? t('keywords.rightClickHint') : undefined}
                        >
                            <option value="">
                                {isLoading
                                    ? t('keywords.loading')
                                    : full
                                        ? t('keywords.full', { max: SLOTS.length })
                                        : t('keywords.choose')}
                            </option>
                            {!full && available.map((k) => (
                                <option key={k.id} value={k.id}>
                                    {k.key_word || t('keywords.unnamed', { id: k.id })}
                                </option>
                            ))}
                        </select>
                        {lookup.canManage && (
                            <p className={styles.hint}>
                                <i className="fas fa-mouse-pointer" aria-hidden="true"></i> {t('keywords.rightClickHint')}
                            </p>
                        )}
                        {lookup.overlay}
                    </div>

                    <div className={styles.modalFooter}>
                        <button type="button" onClick={dismiss} className={styles.btnSecondary}>
                            {t('common.cancel')}
                        </button>
                        <button
                            type="button"
                            onClick={() => void save()}
                            disabled={saving || !changed}
                            className={styles.btnPrimary}
                        >
                            {saving ? (
                                <>
                                    <i className="fas fa-spinner fa-spin" aria-hidden="true"></i> {t('keywords.saving')}
                                </>
                            ) : (
                                <>
                                    <i className="fas fa-save" aria-hidden="true"></i> {t('keywords.save')}
                                </>
                            )}
                        </button>
                    </div>
                </>
            )}
        </Modal>
    );
};

export default WorkKeywordsModal;
