/**
 * CategoryManagerModal Component
 * Modal to list, add, rename, and deactivate stand inventory categories
 */
import { useState, useRef } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import {
  useStandCategories,
  useStandCategoryMutations,
  type StandCategory,
} from '../../hooks/useStand';
import { useToast } from '../../contexts/ToastContext';
import styles from './CategoryManagerModal.module.css';

interface CategoryManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CategoryManagerModal({ isOpen, onClose }: CategoryManagerModalProps) {
  const toast = useToast();
  const { categories, refetch } = useStandCategories();
  const { createCategory, updateCategory, deleteCategory, loading } =
    useStandCategoryMutations(refetch);

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const overlayMouseDownRef = useRef(false);

  if (!isOpen) return null;

  const handleOverlayMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    overlayMouseDownRef.current = e.target === e.currentTarget;
  };

  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    const startedOnOverlay = overlayMouseDownRef.current;
    overlayMouseDownRef.current = false;
    if (e.target === e.currentTarget && startedOnOverlay) {
      onClose();
    }
  };

  const handleAdd = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      await createCategory(name);
      setNewName('');
      toast.success(`Added "${name}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add category');
    }
  };

  const startEdit = (cat: StandCategory) => {
    setEditingId(cat.CategoryID);
    setEditingName(cat.CategoryName);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  const saveEdit = async (id: number) => {
    const name = editingName.trim();
    if (!name) return;
    try {
      await updateCategory(id, { categoryName: name });
      cancelEdit();
      toast.success('Renamed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to rename category');
    }
  };

  const handleDelete = async (cat: StandCategory) => {
    if (!confirm(`Deactivate category "${cat.CategoryName}"? Existing items will keep it, but it won't appear in pickers.`)) {
      return;
    }
    try {
      await deleteCategory(cat.CategoryID);
      toast.success(`Deactivated "${cat.CategoryName}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to deactivate category');
    }
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={handleOverlayMouseDown}
      onClick={handleOverlayClick}
    >
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>Manage Categories</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close modal">
            &times;
          </button>
        </div>

        <div className={styles.modalBody}>
          <form className={styles.addForm} onSubmit={handleAdd}>
            <input
              type="text"
              className={styles.addInput}
              placeholder="New category name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={loading}
              maxLength={100}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !newName.trim()}
            >
              Add
            </button>
          </form>

          {categories.length === 0 ? (
            <p className={styles.emptyHint}>No categories yet. Add one above to get started.</p>
          ) : (
            <ul className={styles.categoryList}>
              {categories.map((cat) => (
                <li key={cat.CategoryID} className={styles.categoryRow}>
                  {editingId === cat.CategoryID ? (
                    <>
                      <input
                        type="text"
                        className={styles.editInput}
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        autoFocus
                        maxLength={100}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void saveEdit(cat.CategoryID);
                          } else if (e.key === 'Escape') {
                            cancelEdit();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => void saveEdit(cat.CategoryID)}
                        disabled={loading || !editingName.trim()}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={cancelEdit}
                        disabled={loading}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <span className={styles.categoryName}>{cat.CategoryName}</span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => startEdit(cat)}
                        disabled={loading}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => void handleDelete(cat)}
                        disabled={loading}
                      >
                        Deactivate
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={styles.modalFooter}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
