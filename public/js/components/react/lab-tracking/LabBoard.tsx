import { useMemo } from 'react';
import cn from 'classnames';
import { LAB_STAGE_META, type LabCaseBoardRow } from '@shared/contracts/lab-case.contract';
import { labelForStage } from '@/config/labStages';
import LabCaseCard from './LabCaseCard';
import styles from './LabBoard.module.css';

interface LabBoardProps {
    cases: LabCaseBoardRow[];
    onOpen: (labCase: LabCaseBoardRow) => void;
}

// The board is the OPEN pipeline only — 'delivered' has no column, so a case
// that reaches it simply drops off the board (its history lives in the modal
// timeline). 'cancelled' isn't a pipeline stage either, so it's naturally excluded too.
const BOARD_STAGES = LAB_STAGE_META.filter((m) => m.key !== 'delivered');

/**
 * One column per open stage (rendered from the contract's LAB_STAGE_META, so
 * a future stage-list change needs no board edit). Empty columns are hidden —
 * with up to 10 open stages a fully-expanded board would overflow. Column
 * headers are tinted by `location` (lab vs. clinic) for a loose visual grouping.
 */
const LabBoard = ({ cases, onOpen }: LabBoardProps) => {
    const byStage = useMemo(() => {
        const map = new Map<string, LabCaseBoardRow[]>();
        for (const c of cases) {
            const list = map.get(c.status);
            if (list) list.push(c);
            else map.set(c.status, [c]);
        }
        return map;
    }, [cases]);

    const columns = BOARD_STAGES.filter((m) => (byStage.get(m.key)?.length ?? 0) > 0);

    if (columns.length === 0) {
        return <div className={styles.empty}>No open lab cases match these filters.</div>;
    }

    return (
        <div className={styles.board}>
            {columns.map((m) => {
                const rows = byStage.get(m.key) ?? [];
                return (
                    <div key={m.key} className={styles.column}>
                        <div className={styles.columnHeader} data-location={m.location}>
                            <span className={styles.columnTitle}>{labelForStage(m.key)}</span>
                            <span className={styles.columnCount}>{rows.length}</span>
                        </div>
                        <div className={cn(styles.columnBody, m.location === 'lab' && styles.columnBodyAtLab)}>
                            {rows.map((c) => <LabCaseCard key={c.id} labCase={c} onOpen={onOpen} />)}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default LabBoard;
