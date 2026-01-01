/**
 * Root Layout for Data Router
 * Wraps all routes with:
 * - GlobalStateProvider (WebSocket, patient state)
 * - ToastProvider (notifications)
 * - PrintQueueProvider (multi-batch label printing)
 * - UniversalHeader (persistent header)
 * - PrintQueueIndicator (floating queue UI)
 * - Suspense (lazy loading)
 */
import { Suspense, useState, useCallback } from 'react';
import { Outlet, ScrollRestoration, Location } from 'react-router-dom';
import { GlobalStateProvider } from '../contexts/GlobalStateContext';
import { ToastProvider } from '../contexts/ToastContext';
import { PrintQueueProvider, usePrintQueue } from '../contexts/PrintQueueContext';
import UniversalHeader from '../components/react/UniversalHeader';
import PrintQueueIndicator from '../components/react/PrintQueueIndicator';
import LabelPreviewModal from '../components/react/LabelPreviewModal';

interface QueuedItem {
  id: string;
  batchNumber: number;
  patientId: string | number;
  patientName: string;
  doctorName?: string;
  doctorLogoPath?: string;
  includeLogo?: boolean;
  labels: string[];
  originalLabels?: string[];
}

function LoadingFallback() {
  return (
    <div className="loading-fallback">
      <div className="loading-fallback-content">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    </div>
  );
}

/**
 * Inner layout component that can use PrintQueue context
 * Manages the queue modal state at the root level
 */
function RootLayoutInner() {
  const [showQueueModal, setShowQueueModal] = useState(false);
  const { queue, clearQueue } = usePrintQueue() as { queue: QueuedItem[]; clearQueue: () => void };

  const handlePrintAll = useCallback(() => {
    setShowQueueModal(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setShowQueueModal(false);
  }, []);

  const handleQueuePrintSuccess = useCallback(() => {
    clearQueue();
    setShowQueueModal(false);
  }, [clearQueue]);

  return (
    <>
      {/* Persistent header - always mounted */}
      <div id="universal-header-root">
        <UniversalHeader />
      </div>

      {/* Main content - routes render here */}
      <div id="app-container">
        <Suspense fallback={<LoadingFallback />}>
          <Outlet />
        </Suspense>
      </div>

      {/* Print Queue Indicator - floating UI */}
      <PrintQueueIndicator onPrintAll={handlePrintAll} />

      {/* Queue Print Modal - opened from indicator */}
      {showQueueModal && queue.length > 0 && (
        <LabelPreviewModal
          queueMode={true}
          queuedItems={queue}
          onClose={handleCloseModal}
          onQueuePrintSuccess={handleQueuePrintSuccess}
        />
      )}

      {/* Native scroll restoration for route navigation */}
      <ScrollRestoration
        getKey={(location: Location) => location.pathname + location.search}
      />
    </>
  );
}

export function RootLayout() {
  return (
    <ToastProvider>
      <GlobalStateProvider>
        <PrintQueueProvider>
          <RootLayoutInner />
        </PrintQueueProvider>
      </GlobalStateProvider>
    </ToastProvider>
  );
}

export default RootLayout;
