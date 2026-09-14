import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MouseEvent, DragEvent } from 'react';
import { getItem, setItem } from '../core/storage';
import { useGlobalState } from '../contexts/GlobalStateContext';
import { roleCaps, type UserRole } from '@shared/auth/roles';

// Dashboard styles - CSS Module
import styles from './Dashboard.module.css';

// Presentation-stable card definitions (icon + route). The human-readable
// strings live in the `dashboard` catalog, keyed by `key`. `as const` keeps each
// `key` a literal so the t(`dashboard:cards.${card.key}.title`) template-literal
// keys stay fully compile-checked against the English catalog.
const DASHBOARD_CARDS = [
  { key: 'appointments', icon: 'fas fa-clock', link: '/appointments' },
  { key: 'addPatient', icon: 'fas fa-user-plus', link: '/patient/new/add' },
  { key: 'searchPatients', icon: 'fas fa-search', link: '/patient-management' },
  { key: 'whatsapp', icon: 'fab fa-whatsapp', link: '/send' },
  { key: 'aligners', icon: 'fas fa-tooth', link: '/aligner' },
  { key: 'expenses', icon: 'fas fa-money-bill-wave', link: '/expenses' },
  { key: 'calendar', icon: 'fas fa-calendar-alt', link: '/calendar' },
  { key: 'videos', icon: 'fas fa-video', link: '/videos' },
  { key: 'statistics', icon: 'fas fa-chart-bar', link: '/statistics' },
  { key: 'settings', icon: 'fas fa-cog', link: '/settings' },
  { key: 'labTracking', icon: 'fas fa-flask', link: '/lab-tracking' },
  { key: 'templates', icon: 'fas fa-file-alt', link: '/templates' },
  { key: 'stand', icon: 'fas fa-store', link: '/stand' },
] as const;

type DashboardCardType = typeof DASHBOARD_CARDS[number];
const STORAGE_KEY = 'dashboard_card_order';

const getInitialCards = (): DashboardCardType[] => {
  const savedOrder = getItem<string[]>(STORAGE_KEY);
  if (savedOrder && Array.isArray(savedOrder)) {
    const cardMap = new Map(DASHBOARD_CARDS.map((c) => [c.key, c]));
    const ordered = savedOrder
      .map((key) => cardMap.get(key as any))
      .filter((c): c is DashboardCardType => !!c);

    // Keep state clean: append any cards defined in code but missing in storage
    const savedKeys = new Set(savedOrder);
    const newCards = DASHBOARD_CARDS.filter((c) => !savedKeys.has(c.key));

    return [...ordered, ...newCards];
  }
  return [...DASHBOARD_CARDS];
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { t } = useTranslation('dashboard');
  const { user } = useGlobalState();

  // Statistics and Stand are admin + front-desk only (server: authorize(FINANCE_ROLES)
  // on /api/statistics and on every /api/stand/* read — the Stand's reads carry cost
  // prices, margins and the sales ledger) — don't offer clinical staff a card that
  // lands on an access-denied page. Filtered at RENDER, not in `cards`, so the saved
  // drag order survives a role change.
  const FINANCE_ONLY_CARDS = new Set(['statistics', 'stand']);
  const caps = roleCaps(user?.role as UserRole | undefined);
  const isVisibleCard = (card: DashboardCardType): boolean =>
    !FINANCE_ONLY_CARDS.has(card.key) || !user?.role || caps.viewFinance;

  const [isCustomizeMode, setIsCustomizeMode] = useState(false);
  const [cards, setCards] = useState<DashboardCardType[]>(getInitialCards);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [isDraggingActive, setIsDraggingActive] = useState(false);

  // What actually gets rendered + reordered. `cards` stays the full saved order.
  const visibleCards = cards.filter(isVisibleCard);

  const isRtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';

  const handleCardClick = (e: MouseEvent<HTMLAnchorElement>, link: string) => {
    e.preventDefault();

    // Prevent page navigation when customize/arrange mode is active
    if (isCustomizeMode) return;

    // Special handling for Appointments - restore last date or default to today
    if (link === '/appointments') {
      const lastDate = sessionStorage.getItem('lastAppointmentDate');
      if (lastDate) {
        navigate(`/appointments?date=${lastDate}`);
      } else {
        // Default to today for first visit
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        navigate(`/appointments?date=${year}-${month}-${day}`);
      }
    } else {
      navigate(link);
    }
  };

  const handleDragStart = (e: DragEvent<HTMLAnchorElement>, index: number) => {
    if (!isCustomizeMode) return;
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());

    // Delay visual feedback class slightly so browser captures clean original drag image
    setTimeout(() => {
      setIsDraggingActive(true);
    }, 0);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setIsDraggingActive(false);
  };

  /**
   * Move a card within the VISIBLE list, then write the result back into the full
   * order — the reordered visible cards drop into the slots visible cards already
   * occupied, so a card hidden by role keeps its saved position and reappears there.
   */
  const reorderVisible = (from: number, to: number) => {
    const nextVisible = [...visibleCards];
    const [moved] = nextVisible.splice(from, 1);
    nextVisible.splice(to, 0, moved);

    let v = 0;
    const updatedCards = cards.map((c) => (isVisibleCard(c) ? nextVisible[v++] : c));

    setCards(updatedCards);
    setItem(STORAGE_KEY, updatedCards.map((c) => c.key));
  };

  const handleDragEnter = (e: DragEvent<HTMLAnchorElement>, index: number) => {
    if (!isCustomizeMode || draggedIndex === null || draggedIndex === index) return;

    reorderVisible(draggedIndex, index);
    setDraggedIndex(index);
  };

  const handleDragOver = (e: DragEvent<HTMLAnchorElement>) => {
    if (isCustomizeMode) {
      e.preventDefault();
    }
  };

  const handleShiftCard = (index: number, direction: 'left' | 'right') => {
    // In RTL, left moves to larger index (forward), right moves to smaller index (backward)
    const isNext = (direction === 'right' && !isRtl) || (direction === 'left' && isRtl);
    const newIndex = isNext ? index + 1 : index - 1;
    if (newIndex < 0 || newIndex >= visibleCards.length) return;

    reorderVisible(index, newIndex);
  };

  const handleResetLayout = () => {
    setItem(STORAGE_KEY, null);
    setCards([...DASHBOARD_CARDS]);
  };

  return (
    <div id="app">
      <main className={styles.mainContent}>
        <div className={styles.container}>
          {/* Subtle Customization Control */}
          <div className={styles.dashboardHeader}>
            {isCustomizeMode && (
              <button
                type="button"
                className={styles.resetButton}
                onClick={handleResetLayout}
                title={t('customize.reset')}
                aria-label={t('customize.reset')}
              >
                <i className="fas fa-undo" aria-hidden="true" />
              </button>
            )}

            <button
              type="button"
              className={`${styles.customizeButton} ${isCustomizeMode ? styles.customizeButtonActive : ''}`}
              onClick={() => setIsCustomizeMode(!isCustomizeMode)}
              title={isCustomizeMode ? t('customize.done') : t('customize.button')}
              aria-label={isCustomizeMode ? t('customize.done') : t('customize.button')}
            >
              <i
                className={isCustomizeMode ? 'fas fa-check' : 'fas fa-cog'}
                aria-hidden="true"
              />
            </button>
          </div>

          <div className={styles.dashboardGrid}>
            {visibleCards.map((card, index) => {
              const isDragging = draggedIndex === index && isDraggingActive;
              const isFirst = index === 0;
              const isLast = index === visibleCards.length - 1;

              // Left moves index down in LTR (towards 0), or up in RTL (towards end)
              const cannotMoveLeft = isRtl ? isLast : isFirst;
              // Right moves index up in LTR (towards end), or down in RTL (towards 0)
              const cannotMoveRight = isRtl ? isFirst : isLast;

              return (
                <a
                  key={card.key}
                  href={card.link}
                  className={`${styles.cardLink} ${isCustomizeMode ? styles.editable : ''} ${
                    isDragging ? styles.dragging : ''
                  }`}
                  onClick={(e) => handleCardClick(e, card.link)}
                  draggable={isCustomizeMode}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragEnd={handleDragEnd}
                  onDragEnter={(e) => handleDragEnter(e, index)}
                  onDragOver={handleDragOver}
                >
                  {isCustomizeMode && (
                    <div
                      className={styles.cardControls}
                    >
                      <div className={styles.gripHandle} title={t('customize.gripTitle')}>
                        <i className="fas fa-grip-lines" aria-hidden="true" />
                      </div>
                      <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleShiftCard(index, 'left');
                        }}
                        disabled={cannotMoveLeft}
                        title={t('customize.moveLeft')}
                        aria-label={t('customize.moveLeftLabel')}
                      >
                        <i className="fas fa-arrow-left" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleShiftCard(index, 'right');
                        }}
                        disabled={cannotMoveRight}
                        title={t('customize.moveRight')}
                        aria-label={t('customize.moveRightLabel')}
                      >
                        <i className="fas fa-arrow-right" aria-hidden="true" />
                      </button>
                    </div>
                  )}

                  <div className={styles.dashboardCard}>
                    <div className={styles.cardIcon}>
                      <i className={card.icon}></i>
                    </div>
                    <h3>{t(`cards.${card.key}.title`)}</h3>
                    <p>{t(`cards.${card.key}.description`)}</p>
                    <div className={styles.cardFooter}>
                      <span>{t(`cards.${card.key}.linkText`)}</span>
                      <i className="fas fa-arrow-right"></i>
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      </main>

      <footer className={styles.footer}>
        <div className={styles.container}>
          <p>{t('footer.copyright', { year: new Date().getFullYear() })}</p>
        </div>
      </footer>
    </div>
  );
}

