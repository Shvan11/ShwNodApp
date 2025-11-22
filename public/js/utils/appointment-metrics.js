/**
 * Appointment Metrics Collector
 * Tracks duplicate prevention and synchronization health
 * Lightweight instrumentation for development and debugging
 */

class AppointmentMetrics {
  constructor() {
    this.reset();
  }

  reset() {
    this.metrics = {
      // Duplicate prevention
      duplicateEventsBlocked: 0,
      duplicateAppointmentsBlocked: 0,

      // Event processing
      totalEventsReceived: 0,
      ownActionsSkipped: 0,
      externalActionsProcessed: 0,

      // Ordering
      outOfOrderEvents: 0,
      maxTimeDrift: 0,

      // State management
      optimisticUpdates: 0,
      serverVerificationPassed: 0,
      serverVerificationFailed: 0,
      rollbacksTriggered: 0,

      // Performance
      granularUpdatesUsed: 0,
      fullReloadsTriggered: 0,

      // Connection
      reconnections: 0,
      lastResetTime: Date.now()
    };
  }

  // Duplicate prevention
  recordDuplicateEventBlocked() {
    this.metrics.duplicateEventsBlocked++;
  }

  recordDuplicateAppointmentBlocked() {
    this.metrics.duplicateAppointmentsBlocked++;
  }

  // Event processing
  recordEventReceived(isOwnAction) {
    this.metrics.totalEventsReceived++;
    if (isOwnAction) {
      this.metrics.ownActionsSkipped++;
    } else {
      this.metrics.externalActionsProcessed++;
    }
  }

  // Ordering
  recordOutOfOrderEvent(timeDrift) {
    this.metrics.outOfOrderEvents++;
    if (timeDrift > this.metrics.maxTimeDrift) {
      this.metrics.maxTimeDrift = timeDrift;
    }
  }

  // State management
  recordOptimisticUpdate() {
    this.metrics.optimisticUpdates++;
  }

  recordServerVerification(passed) {
    if (passed) {
      this.metrics.serverVerificationPassed++;
    } else {
      this.metrics.serverVerificationFailed++;
    }
  }

  recordRollback() {
    this.metrics.rollbacksTriggered++;
  }

  // Performance
  recordGranularUpdate() {
    this.metrics.granularUpdatesUsed++;
  }

  recordFullReload() {
    this.metrics.fullReloadsTriggered++;
  }

  // Connection
  recordReconnection() {
    this.metrics.reconnections++;
  }

  // Get metrics snapshot
  getMetrics() {
    const now = Date.now();
    const uptime = Math.floor((now - this.metrics.lastResetTime) / 1000); // seconds

    return {
      ...this.metrics,
      uptime,
      // Health indicators
      health: {
        duplicateRate: this.metrics.totalEventsReceived > 0
          ? (this.metrics.duplicateEventsBlocked / this.metrics.totalEventsReceived * 100).toFixed(2) + '%'
          : '0%',
        verificationSuccessRate: (this.metrics.serverVerificationPassed + this.metrics.serverVerificationFailed) > 0
          ? (this.metrics.serverVerificationPassed / (this.metrics.serverVerificationPassed + this.metrics.serverVerificationFailed) * 100).toFixed(2) + '%'
          : '100%',
        outOfOrderRate: this.metrics.externalActionsProcessed > 0
          ? (this.metrics.outOfOrderEvents / this.metrics.externalActionsProcessed * 100).toFixed(2) + '%'
          : '0%',
        granularUpdateRate: (this.metrics.granularUpdatesUsed + this.metrics.fullReloadsTriggered) > 0
          ? (this.metrics.granularUpdatesUsed / (this.metrics.granularUpdatesUsed + this.metrics.fullReloadsTriggered) * 100).toFixed(2) + '%'
          : '0%'
      }
    };
  }

  // Log summary to console
  logSummary() {
    const metrics = this.getMetrics();

    console.group('📊 [AppointmentMetrics] Summary');
    console.log('⏱️  Uptime:', metrics.uptime + 's');
    console.log('📨 Events Received:', metrics.totalEventsReceived);
    console.log('✅ Duplicate Events Blocked:', metrics.duplicateEventsBlocked, `(${metrics.health.duplicateRate})`);
    console.log('✅ Duplicate Appointments Blocked:', metrics.duplicateAppointmentsBlocked);
    console.log('⚠️  Out-of-Order Events:', metrics.outOfOrderEvents, `(${metrics.health.outOfOrderRate})`);
    console.log('🎯 Server Verification:', `${metrics.serverVerificationPassed} passed, ${metrics.serverVerificationFailed} failed`, `(${metrics.health.verificationSuccessRate})`);
    console.log('🔄 Rollbacks:', metrics.rollbacksTriggered);
    console.log('⚡ Granular Updates:', metrics.granularUpdatesUsed, `(${metrics.health.granularUpdateRate})`);
    console.log('🔌 Reconnections:', metrics.reconnections);
    console.groupEnd();

    return metrics;
  }

  // Check if system is healthy
  isHealthy() {
    const metrics = this.getMetrics();

    // Health criteria:
    // 1. Verification success rate > 95%
    // 2. Out-of-order rate < 10%
    // 3. Not too many rollbacks (< 5% of optimistic updates)

    const verificationRate = parseFloat(metrics.health.verificationSuccessRate);
    const outOfOrderRate = parseFloat(metrics.health.outOfOrderRate);
    const rollbackRate = metrics.optimisticUpdates > 0
      ? (metrics.rollbacksTriggered / metrics.optimisticUpdates * 100)
      : 0;

    return verificationRate > 95 && outOfOrderRate < 10 && rollbackRate < 5;
  }
}

// Export singleton instance
export const appointmentMetrics = new AppointmentMetrics();

// Expose to window for debugging
if (typeof window !== 'undefined') {
  window.__appointmentMetrics = appointmentMetrics;
  console.log('📊 [AppointmentMetrics] Initialized - Access via window.__appointmentMetrics.logSummary()');
}

export default appointmentMetrics;
