/**
 * useLookupManager — the app-wide entry point for "right-click a dropdown → edit
 * its values". Attach the returned `onContextMenu` to any element (typically a
 * <select>) and render the returned `overlay` once; the hook owns the context menu
 * and the LookupManagerModal it opens.
 *
 * It's deliberately decoupled from any one table: pass the lookup whitelist key
 * (e.g. 'tblLabs') plus the query keys of whatever dropdown feeds consume that
 * table, and the hook invalidates them after any edit so the live dropdown
 * refreshes. Wiring a new lookup is then a one-liner at the call site — no new
 * component per table.
 *
 *   const lab = useLookupManager({ tableKey: 'tblLabs', invalidateKeys: [qk.lookups.labs()] });
 *   <select onContextMenu={lab.onContextMenu}>…</select>
 *   {lab.overlay}
 *
 * Returning JSX from a hook keeps the call site from having to thread menu/modal
 * state by hand; the React Compiler memoizes it, so no manual useCallback/useMemo
 * (per the project convention).
 */
import { useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { QueryKey } from '@tanstack/react-query';
import LookupContextMenu from '../components/react/LookupContextMenu';
import LookupManagerModal from '../components/react/LookupManagerModal';
import { useAuthUser } from '../contexts/GlobalStateContext';
import { roleCaps, type UserRole } from '@shared/auth/roles';

interface UseLookupManagerOptions {
  /** Whitelist key of the lookup table to manage (e.g. 'tblLabs'). */
  tableKey: string;
  /** Modal title override; defaults to `common:lookups.manage` ("Manage <displayName>"). */
  title?: string;
  /**
   * Context-menu item label; defaults to `common:lookups.editValues`. The defaults
   * are catalog strings, not literals: this shared hook renders on translated
   * screens, where the i18n lint ratchet (which checks per FILE) cannot see a
   * literal living in here (audit FE-F3-13).
   */
  menuLabel?: string;
  /** Query keys of dropdown feeds to invalidate after any edit. */
  invalidateKeys?: QueryKey[];
  /** Extra callback after any successful create/update/delete. */
  onChanged?: () => void;
}

interface UseLookupManagerResult {
  /** Attach to the element (e.g. a <select>) that should open the menu on right-click. */
  onContextMenu: (event: MouseEvent) => void;
  /** Render once in the component tree (portals out — placement is irrelevant). */
  overlay: ReactNode;
  /** Whether this user gets the menu at all — gate a "right-click to edit" hint on it. */
  canManage: boolean;
}

export function useLookupManager({
  tableKey,
  title,
  menuLabel,
  invalidateKeys,
  onChanged,
}: UseLookupManagerOptions): UseLookupManagerResult {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // The lookup tables are `admin|front_desk` on the server. Clinical users reach two
  // of these selects (work items, lab cases); for them the right-click stays the
  // browser's own menu instead of opening a manager whose every read 403s (FE-F21-3).
  const user = useAuthUser();
  const canManage = roleCaps(user?.role as UserRole | undefined).manageLookups;

  const handleContextMenu = (event: MouseEvent): void => {
    if (!canManage) return;
    event.preventDefault();
    setMenuPos({ x: event.clientX, y: event.clientY });
  };

  const handleChanged = (): void => {
    invalidateKeys?.forEach((queryKey) => {
      void queryClient.invalidateQueries({ queryKey });
    });
    onChanged?.();
  };

  const menuItems = [
    {
      key: 'edit',
      label: menuLabel ?? t('lookups.editValues'),
      icon: 'fa-pen',
      onClick: () => {
        setMenuPos(null);
        setIsModalOpen(true);
      },
    },
  ];

  const overlay = canManage && (
    <>
      {menuPos && (
        <LookupContextMenu
          x={menuPos.x}
          y={menuPos.y}
          onClose={() => setMenuPos(null)}
          items={menuItems}
        />
      )}
      <LookupManagerModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        tableKey={tableKey}
        title={title}
        onChanged={handleChanged}
      />
    </>
  );

  return { onContextMenu: handleContextMenu, overlay, canManage };
}
