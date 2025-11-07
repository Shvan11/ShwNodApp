// Shared receipt generator for thermal printer (80mm x 210mm landscape)
// Used by both PaymentModal and WorkComponent

export const generateReceiptHTML = (receiptData) => {
    const formatCurrency = (amount, currency) => {
        if (isNaN(amount) || amount === null || amount === undefined) {
            return `0 ${currency}`;
        }
        return `${Math.round(amount).toLocaleString('en-US')} ${currency}`;
    };

    const formatDateTime = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return `
        <div class="print-only receipt-thermal">
            <div class="receipt-clinic-header">
                <h1>SHWAN ORTHODONTICS</h1>
                <div class="clinic-details">
                    <div>📍 Sulaymaniyah, Kurdistan - Iraq</div>
                    <div>📞 +964 750 123 4567 | +964 770 987 6543</div>
                </div>
            </div>

            <div class="receipt-divider"></div>

            <div class="invoice-header-info">
                <div class="invoice-title">PAYMENT RECEIPT</div>
                <div class="invoice-meta">
                    <div>Invoice Date: ${formatDateTime(receiptData.paymentDateTime)}</div>
                    <div>Receipt #: ${receiptData.workid}-${new Date().getTime().toString().slice(-6)}</div>
                </div>
            </div>

            <div class="receipt-divider"></div>

            <div class="receipt-content-grid">
                <div class="receipt-col">
                    <div class="info-section">
                        <div class="section-label">PATIENT INFORMATION</div>
                        <div class="info-item">
                            <span class="info-label">Name:</span>
                            <span class="info-value">${receiptData.PatientName || 'N/A'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Phone:</span>
                            <span class="info-value">${receiptData.Phone || 'N/A'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Patient ID:</span>
                            <span class="info-value">${receiptData.PersonID || 'N/A'}</span>
                        </div>
                    </div>

                    <div class="info-section">
                        <div class="section-label">NEXT APPOINTMENT</div>
                        <div class="appointment-info">
                            ${receiptData.AppDate ? formatDateTime(receiptData.AppDate) : 'Not Scheduled'}
                        </div>
                    </div>
                </div>

                <div class="receipt-col">
                    <div class="info-section payment-section">
                        <div class="section-label">PAYMENT DETAILS</div>

                        <div class="payment-row">
                            <span>Total Treatment Cost:</span>
                            <span>${formatCurrency(receiptData.TotalRequired || 0, receiptData.Currency)}</span>
                        </div>

                        <div class="payment-row">
                            <span>Previously Paid:</span>
                            <span>${formatCurrency(receiptData.TotalPaid || 0, receiptData.Currency)}</span>
                        </div>

                        <div class="payment-row-divider"></div>

                        <div class="payment-row highlight-payment">
                            <span>Paid Today:</span>
                            <span class="amount-big">${formatCurrency(receiptData.amountPaidToday || 0, receiptData.Currency)}</span>
                        </div>

                        <div class="payment-row-divider"></div>

                        <div class="payment-row total-row">
                            <span>Total Paid:</span>
                            <span class="amount-big">${formatCurrency((receiptData.TotalPaid || 0) + (receiptData.amountPaidToday || 0), receiptData.Currency)}</span>
                        </div>

                        <div class="payment-row balance-row">
                            <span>Remaining Balance:</span>
                            <span class="amount-big ${receiptData.newBalance <= 0 ? 'paid-full' : 'balance-due'}">
                                ${formatCurrency(receiptData.newBalance, receiptData.Currency)}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="receipt-footer-section">
                <div class="thank-you">Thank you for your payment!</div>
                <div class="footer-note">Keep this receipt for your records</div>
            </div>
        </div>
    `;
};

// Helper to print receipt directly from data
export const printReceipt = (receiptData) => {
    const container = document.createElement('div');
    container.innerHTML = generateReceiptHTML(receiptData);
    document.body.appendChild(container);

    setTimeout(() => {
        window.print();
        setTimeout(() => document.body.removeChild(container), 100);
    }, 100);
};
