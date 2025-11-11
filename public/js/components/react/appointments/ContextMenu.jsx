import React, { useEffect, useRef } from 'react';

/**
 * ContextMenu Component
 * Right-click context menu for appointment actions
 */
const ContextMenu = ({ position, status, onClose, onMarkSeated, onMarkDismissed, onUndoState }) => {
    const menuRef = useRef(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                onClose();
            }
        };

        // Add a small delay to prevent immediate closing
        setTimeout(() => {
            document.addEventListener('click', handleClickOutside);
        }, 100);

        return () => {
            document.removeEventListener('click', handleClickOutside);
        };
    }, [onClose]);

    const handleAction = (action) => {
        action();
        onClose();
    };

    const renderMenuItems = () => {
        const statusLower = status.toLowerCase();

        if (statusLower === 'present') {
            return (
                <>
                    <div className="context-menu-item" onClick={() => handleAction(onMarkSeated)}>
                        <i className="fas fa-chair"></i>
                        <span>Seat Patient</span>
                    </div>
                    <div className="context-menu-divider"></div>
                    <div className="context-menu-item context-menu-item-danger" onClick={() => handleAction(() => onUndoState('Present'))}>
                        <i className="fas fa-undo"></i>
                        <span>Undo Check-in</span>
                    </div>
                </>
            );
        } else if (statusLower === 'seated') {
            return (
                <>
                    <div className="context-menu-item" onClick={() => handleAction(onMarkDismissed)}>
                        <i className="fas fa-check-circle"></i>
                        <span>Complete Visit</span>
                    </div>
                    <div className="context-menu-divider"></div>
                    <div className="context-menu-item context-menu-item-danger" onClick={() => handleAction(() => onUndoState('Seated'))}>
                        <i className="fas fa-undo"></i>
                        <span>Undo Seating</span>
                    </div>
                </>
            );
        } else if (statusLower === 'dismissed') {
            return (
                <div className="context-menu-item context-menu-item-danger" onClick={() => handleAction(() => onUndoState('Dismissed'))}>
                    <i className="fas fa-undo"></i>
                    <span>Undo Dismiss</span>
                </div>
            );
        }

        return null;
    };

    return (
        <div
            ref={menuRef}
            className="context-menu"
            style={{
                left: `${position.x}px`,
                top: `${position.y}px`
            }}
        >
            {renderMenuItems()}
        </div>
    );
};

export default ContextMenu;
