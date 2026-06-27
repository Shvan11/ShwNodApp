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
import type { QueryKey } from '@tanstack/react-query';
import LookupContextMenu from '../components/react/LookupContextMenu';
import LookupManagerModal from '../components/react/LookupManagerModal';

interface UseLookupManagerOptions {
  /** Whitelist key of the lookup table to manage (e.g. 'tblLabs'). */
  tableKey: string;
  /** Modal title override; defaults to `Manage <displayName>`. */
  title?: string;
  /** Context-menu item label; defaults to 'Edit values'. */
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
}

export function useLookupManager({
  tableKey,
  title,
  menuLabel = 'Edit values',
  invalidateKeys,
  onChanged,
}: UseLookupManagerOptions): UseLookupManagerResult {
  const queryClient = useQueryClient();
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    setMenuPos({ x: event.clientX, y: event.clientY });
  };

  const handleChanged = (): void => {
    invalidateKeys?.forEach((queryKey) => {
      void queryClient.invalidateQueries({ queryKey });
    });
    onChanged?.();
  };

  const overlay = (
    <>
      {menuPos && (
        <LookupContextMenu
          x={menuPos.x}
          y={menuPos.y}
          onClose={() => setMenuPos(null)}
          items={[
            {
              key: 'edit',
              label: menuLabel,
              icon: 'fa-pen',
              onClick: () => {
                setMenuPos(null);
                setIsModalOpen(true);
              },
            },
          ]}
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

  return { onContextMenu: handleContextMenu, overlay };
}
