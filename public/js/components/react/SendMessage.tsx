import { useState, useEffect } from 'react';
import type { FormEvent, ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import Select, { SingleValue, StylesConfig } from 'react-select';
import { useGlobalState } from '../../contexts/GlobalStateContext';

interface ContactData {
    id?: string | number;
    phone: string;
    name?: string;
    text?: string;
    [key: string]: unknown;
}

interface ContactOption {
    value: string | number;
    label: string;
    phone: string;
    name: string;
    contactData: ContactData;
}

type StatusType = 'success' | 'error' | 'warning' | 'auth-required' | '';

// Type for react-select styles
type SelectStylesConfig = StylesConfig<ContactOption, false>;

const SendMessage = () => {
    const navigate = useNavigate();

    // Use global state for WhatsApp client status
    const { whatsappClientReady } = useGlobalState();

    const [filePath, setFilePath] = useState('');
    const [pathsArray, setPathsArray] = useState<string[]>([]);
    const [selectedSource, setSelectedSource] = useState('pat');
    const [contactOptions, setContactOptions] = useState<ContactOption[]>([]);
    const [selectedContact, setSelectedContact] = useState<ContactOption | null>(null);
    const [phoneNumber, setPhoneNumber] = useState('');
    const [program, setProgram] = useState('WhatsApp');
    const [statusMessage, setStatusMessage] = useState('');
    const [statusType, setStatusType] = useState<StatusType>('');

    // Initialize component
    useEffect(() => {
        // Parse URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const fileParam = urlParams.get('file');
        if (fileParam) {
            const decodedPath = decodeURIComponent(fileParam);
            setFilePath(decodedPath);
            setPathsArray(decodedPath.split(','));
        }

        // Load contacts
        loadContacts('pat');

        // No cleanup needed - useWhatsAppWebSocket hook handles WebSocket lifecycle
    }, []);

    // Load contacts based on source
    const loadContacts = async (source: string) => {
        try {
            let response;
            if (source === 'pat') {
                response = await fetch('/api/patients/phones');
            } else {
                response = await fetch(`/api/google?source=${encodeURIComponent(source)}`);
            }

            if (response.ok) {
                const data = await response.json();
                const contactsArray: ContactData[] = Array.isArray(data) ? data : [];

                // Convert to React-Select format
                const options: ContactOption[] = contactsArray.map(contact => ({
                    value: contact.id || contact.phone,
                    label: `${contact.name || contact.text} - ${contact.phone}`,
                    phone: contact.phone,
                    name: contact.name || contact.text || '',
                    contactData: contact
                }));
                setContactOptions(options);
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.error('Error loading contacts:', error);
            showMessage(`Failed to load contacts: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
            setContactOptions([]);
        }
    };

    // Handle source change
    const handleSourceChange = (newSource: string) => {
        setSelectedSource(newSource);
        setSelectedContact(null);
        setPhoneNumber('');
        loadContacts(newSource);
    };

    // Handle contact selection with React-Select
    const handleContactSelect = (selectedOption: SingleValue<ContactOption>) => {
        setSelectedContact(selectedOption);

        if (selectedOption && selectedOption.phone) {
            if (selectedSource === 'pat') {
                setPhoneNumber('964' + selectedOption.phone);
            } else {
                // Format other phone types
                const match = selectedOption.phone.match(/(?:(?:(?:00)|\+)(?:964)|0)[ ]?(\d{3})[ ]?(\d{3})[ ]?(\d{4})/);
                if (match) {
                    setPhoneNumber('964' + match[1] + match[2] + match[3]);
                } else {
                    setPhoneNumber(selectedOption.phone);
                }
            }
        } else {
            setPhoneNumber('');
        }
    };

    // Handle form submission
    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        // Validate inputs
        if (!phoneNumber.trim()) {
            showMessage('Please enter a phone number', 'error');
            return;
        }

        if (!filePath.trim()) {
            showMessage('Please select a file to send', 'error');
            return;
        }

        // Check WhatsApp client status if WhatsApp is selected
        if (program === 'WhatsApp' && !whatsappClientReady) {
            showAuthenticationRequired();
            return;
        }

        // Prepare form data
        const formData = new FormData();
        formData.append('prog', program);
        formData.append('phone', phoneNumber);
        formData.append('file', filePath);

        try {
            const response = await fetch('/api/sendmedia2', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.result === 'OK') {
                const fileCount = pathsArray.length;
                showMessage(`${program} message sent successfully! (${data.sentMessages || 0}/${fileCount} files sent)`, 'success');
            } else if (data.error) {
                showMessage(`${program} Error: ${data.error}`, 'error');
            } else {
                showMessage('Unknown error occurred while sending message', 'error');
            }
        } catch (error) {
            console.error('Error sending message:', error);
            showMessage(`Failed to send ${program} message: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
        }
    };

    // Show message
    const showMessage = (message: string, type: StatusType) => {
        setStatusMessage(message);
        setStatusType(type);

        // Auto-remove success messages after 5 seconds
        if (type === 'success') {
            setTimeout(() => {
                setStatusMessage('');
                setStatusType('');
            }, 5000);
        }
    };

    // Show authentication required message
    const showAuthenticationRequired = () => {
        setStatusMessage('');
        setStatusType('auth-required');
    };

    // Handle close
    const handleClose = () => {
        // Close the window
        if (window.opener) {
            window.close();
        } else {
            navigate('/');
        }
    };

    // Custom styles for react-select
    const selectStyles: SelectStylesConfig = {
        control: (provided) => ({
            ...provided,
            minHeight: '42px',
            width: '100%',
            minWidth: '350px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontSize: '16px',
            fontFamily: "'Raleway', sans-serif"
        }),
        container: (provided) => ({
            ...provided,
            width: '100%'
        }),
        valueContainer: (provided) => ({
            ...provided,
            width: '100%',
            flexWrap: 'nowrap'
        }),
        menu: (provided) => ({
            ...provided,
            zIndex: 9999
        }),
        option: (provided, state) => ({
            ...provided,
            backgroundColor: state.isSelected ? '#25D366' : state.isFocused ? '#f8f9fa' : 'white',
            color: state.isSelected ? 'white' : '#333',
            padding: '10px 12px'
        }),
        placeholder: (provided, state) => ({
            ...provided,
            color: '#666',
            fontStyle: 'italic',
            opacity: state.isFocused ? 0 : 1,
            transition: 'opacity 0.15s ease'
        })
    };

    return (
        <div className="send-message-container">
            {/* Status Messages */}
            {statusMessage && (
                <div className={`status-message ${statusType}`}>
                    {statusMessage}
                </div>
            )}

            {statusType === 'auth-required' && (
                <div className="status-message auth-required">
                    <h3>WhatsApp Authentication Required</h3>
                    <p>The WhatsApp client needs to be authenticated before sending messages.</p>
                    <div className="auth-actions">
                        <button
                            onClick={() => window.open('/auth', 'whatsappAuth', 'width=600,height=700,resizable=yes,scrollbars=yes')}
                            className="auth-popup-btn"
                        >
                            <span className="btn-icon">📱</span>
                            Authenticate WhatsApp
                        </button>
                        <button
                            onClick={() => window.location.reload()}
                            className="retry-btn"
                        >
                            <span className="btn-icon">🔄</span>
                            Check Again
                        </button>
                    </div>
                    <div className="auth-help">
                        <p><small>Click "Authenticate WhatsApp" to scan QR code in a popup window</small></p>
                    </div>
                </div>
            )}

            {/* Source Selection */}
            <div className="form-group">
                <select
                    value={selectedSource}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => handleSourceChange(e.target.value)}
                    className="wainput"
                >
                    <option value="pat">Patients' Phones</option>
                    <option value="shw">Dr. Shwan Phone</option>
                    <option value="cli">Clinic Phone</option>
                </select>
            </div>

            {/* Contact Selection with React-Select */}
            <div className="form-group">
                <Select<ContactOption, false>
                    value={selectedContact}
                    onChange={handleContactSelect}
                    options={contactOptions}
                    isSearchable={true}
                    isClearable={true}
                    placeholder="Search and select a contact..."
                    noOptionsMessage={() => "No contacts found"}
                    className="react-select-container"
                    classNamePrefix="react-select"
                    blurInputOnSelect={false}
                    closeMenuOnSelect={true}
                    hideSelectedOptions={false}
                    styles={selectStyles}
                />
            </div>

            {/* Main Form */}
            <form onSubmit={handleSubmit} className="waform">
                <button
                    type="button"
                    onClick={handleClose}
                    className="close-btn"
                    aria-label="Close"
                >
                    <i className="fa-solid fa-rectangle-xmark fa-2xl"></i>
                </button>

                <h2>Send WhatsApp</h2>
                <hr />

                {/* Program Selection */}
                <div className="form-group">
                    <select
                        value={program}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) => setProgram(e.target.value)}
                        className="wainput"
                    >
                        <option value="WhatsApp">WhatsApp</option>
                        <option value="Telegram">Telegram</option>
                    </select>
                </div>

                {/* Phone Input */}
                <div className="phone-input-wrapper">
                    <input
                        type="text"
                        value={phoneNumber}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setPhoneNumber(e.target.value)}
                        placeholder="Phone number"
                        className="wainput"
                        required
                    />
                </div>

                {/* File Input */}
                <div className="form-group">
                    <input
                        type="text"
                        value={filePath}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setFilePath(e.target.value)}
                        placeholder="File path"
                        className="wainput"
                        required
                        readOnly
                    />
                </div>

                {/* Submit Button */}
                <button type="submit" className="btn btn-warning btn-block mt-4">
                    Send
                </button>

                {/* Progress Bar */}
                <div className="progress-container">
                    <div id="emptyBar">
                        <div id="filledBar"></div>
                    </div>
                </div>
            </form>
        </div>
    );
};

export default SendMessage;
