import React, { useState, useEffect, useRef } from 'react';
import Select from 'react-select';
import { useGlobalState } from '../../contexts/GlobalStateContext.jsx';
// TODO: Integrate React ProgressBar component from components/whatsapp-send/ProgressBar.jsx
// The old class-based ProgressBar no longer exists - needs refactoring to use React component
// import ProgressBar from '../whatsapp-send/ProgressBar.jsx';

const SendMessage = () => {
    // Use global state for WhatsApp client ready status
    const { whatsappClientReady } = useGlobalState();

    const [filePath, setFilePath] = useState('');
    const [pathsArray, setPathsArray] = useState([]);
    const [selectedSource, setSelectedSource] = useState('pat');
    const [contactOptions, setContactOptions] = useState([]);
    const [selectedContact, setSelectedContact] = useState(null);
    const [phoneNumber, setPhoneNumber] = useState('');
    const [program, setProgram] = useState('WhatsApp');
    const [clientError, setClientError] = useState(null);
    const [statusMessage, setStatusMessage] = useState('');
    const [statusType, setStatusType] = useState(''); // 'success', 'error', 'warning'

    const progressBarRef = useRef(null);
    const connectionManagerRef = useRef(null);

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

        // TODO: Re-implement progress bar with React component
        // Old class-based ProgressBar code removed - component still functional without it
        /*
        const emptyBar = document.getElementById('emptyBar');
        const filledBar = document.getElementById('filledBar');
        if (emptyBar && filledBar) {
            progressBarRef.current = new ProgressBar({
                filledBar,
                emptyBar,
                interval: 200
            });
        }
        */

        // Initialize WebSocket and load contacts
        initializeWebSocket();
        loadContacts('pat');

        // Cleanup function - no listeners to clean up since we use GlobalStateContext
        // WebSocket cleanup is handled by the singleton service
        return () => {
            // connectionManagerRef cleanup is handled by the singleton service
            // No manual listener cleanup needed - we use GlobalStateContext
        };
    }, []);
    
    // Initialize WebSocket connection
    const initializeWebSocket = async () => {
        try {
            const websocketService = (await import('../../services/websocket.js')).default;
            connectionManagerRef.current = websocketService;

            // NOTE: whatsapp_client_ready is managed by GlobalStateContext - no duplicate listener needed
            // The whatsappClientReady state is already available from useGlobalState hook

            // Connect to WebSocket
            await connectionManagerRef.current.connect({
                clientType: 'send-message',
                timestamp: Date.now()
            });

            // No need to request initial state for clientReady - GlobalStateContext handles it
            // Just check if we need fallback for error handling
            if (!connectionManagerRef.current.isConnected) {
                fallbackStatusCheck();
            }
        } catch (error) {
            console.error('Failed to initialize WebSocket:', error);
            setClientError(error.message);
            fallbackStatusCheck();
        }
    };
    
    // Fallback API status check
    const fallbackStatusCheck = async () => {
        try {
            const response = await fetch('/api/wa/status');
            if (response.ok) {
                const data = await response.json();
                setClientStatus({
                    ready: data.clientReady || false,
                    error: data.error || null
                });
            }
        } catch (error) {
            console.error('Fallback status check failed:', error);
            setClientStatus({
                ready: false,
                error: error.message
            });
        }
    };
    
    // Load contacts based on source
    const loadContacts = async (source) => {
        try {
            let response;
            if (source === 'pat') {
                response = await fetch('/api/patientsPhones');
            } else {
                response = await fetch(`/api/google?source=${encodeURIComponent(source)}`);
            }
            
            if (response.ok) {
                const data = await response.json();
                const contactsArray = Array.isArray(data) ? data : [];
                
                // Convert to React-Select format
                const options = contactsArray.map(contact => ({
                    value: contact.id || contact.phone,
                    label: `${contact.name || contact.text} - ${contact.phone}`,
                    phone: contact.phone,
                    name: contact.name || contact.text,
                    contactData: contact
                }));
                setContactOptions(options);
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.error('Error loading contacts:', error);
            showMessage(`Failed to load contacts: ${error.message}`, 'error');
            setContactOptions([]);
        }
    };
    
    // Handle source change
    const handleSourceChange = (newSource) => {
        setSelectedSource(newSource);
        setSelectedContact(null);
        setPhoneNumber('');
        loadContacts(newSource);
    };
    
    // Handle contact selection with React-Select
    const handleContactSelect = (selectedOption) => {
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
    const handleSubmit = async (e) => {
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
            if (clientError) {
                showMessage(`WhatsApp Error: ${clientError}`, 'error');
            } else {
                showAuthenticationRequired();
            }
            return;
        }
        
        // TODO: Start progress bar (disabled - needs React component integration)
        // if (progressBarRef.current) {
        //     progressBarRef.current.initiate();
        // }
        
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
                // TODO: progressBarRef.current.finish();
                const fileCount = pathsArray.length;
                showMessage(`${program} message sent successfully! (${data.sentMessages || 0}/${fileCount} files sent)`, 'success');
            } else if (data.error) {
                // TODO: progressBarRef.current.reset();
                showMessage(`${program} Error: ${data.error}`, 'error');
            } else {
                // TODO: progressBarRef.current.reset();
                showMessage('Unknown error occurred while sending message', 'error');
            }
        } catch (error) {
            console.error('Error sending message:', error);
            // TODO: progressBarRef.current.reset();
            showMessage(`Failed to send ${program} message: ${error.message}`, 'error');
        }
    };
    
    // Show message
    const showMessage = (message, type) => {
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
        // Cleanup WebSocket connection
        if (connectionManagerRef.current) {
            connectionManagerRef.current.disconnect();
        }
        
        // Close the window
        if (window.opener) {
            window.close();
        } else {
            window.location.href = '/';
        }
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
                    onChange={(e) => handleSourceChange(e.target.value)}
                    className="wainput"
                >
                    <option value="pat">Patients' Phones</option>
                    <option value="shw">Dr. Shwan Phone</option>
                    <option value="cli">Clinic Phone</option>
                </select>
            </div>
            
            {/* Contact Selection with React-Select */}
            <div className="form-group">
                <Select
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
                    menuIsOpen={undefined}
                    styles={{
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
                            opacity: state.isFocused || state.menuIsOpen ? 0 : 1,
                            transition: 'opacity 0.15s ease'
                        })
                    }}
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
                        onChange={(e) => setProgram(e.target.value)}
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
                        onChange={(e) => setPhoneNumber(e.target.value)}
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
                        onChange={(e) => setFilePath(e.target.value)}
                        placeholder="File path"
                        className="wainput"
                        required
                        readOnly
                    />
                </div>
                
                {/* Submit Button */}
                <button type="submit" className="submit-btn">
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