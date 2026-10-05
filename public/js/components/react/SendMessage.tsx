import { useState } from 'react';
import type { FormEvent, ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import Select, { SingleValue } from 'react-select';
import { useQuery } from '@tanstack/react-query';
import { useWhatsAppStatus } from '../../contexts/GlobalStateContext';
import { postFormData, httpErrorMessage } from '@/core/http';
import { patientPhonesQuery, googleContactsQuery } from '@/query/queries';
import { GOOGLE_CONTACT_ACCOUNTS } from '@shared/google-contacts-accounts';
import styles from './SendMessage.module.css';

interface Contact {
    id: string | number;
    name: string;
    phone: string;
}

interface ContactOption {
    value: string | number;
    label: string;
    phone: string;
}

/** `/api/wa/sendmedia2`'s raw answer: how many of the files went, and why the others didn't. */
interface SendMediaResult {
    result?: string;
    sentMessages?: number;
    total?: number;
    error?: string;
    errors?: string[];
}

type StatusType = 'success' | 'error' | 'warning';

/** `/sendmedia2` is mounted with a 120 s timeout: several files, or one big Telegram file, take longer than the funnel's 30 s default (FE-F16-6). */
const SEND_TIMEOUT_MS = 120_000;

// The patients' phone book, then every Google contact account in the registry —
// an account added there appears here without an edit (FE-F16-14).
const SOURCES: ReadonlyArray<{ id: string; label: string }> = [
    { id: 'pat', label: "Patients' Phones" },
    ...GOOGLE_CONTACT_ACCOUNTS.map((a) => ({ id: a.id, label: a.label })),
];

const SendMessage = () => {
    const navigate = useNavigate();

    // Live: the auth-required banner clears itself the moment the client pairs.
    const { clientReady: whatsappClientReady } = useWhatsAppStatus();

    // Seed from the ?file= URL param once on mount (lazy initializers, so there's no
    // setState-in-effect just to read the launch URL).
    const [filePath, setFilePath] = useState(() => {
        const fileParam = new URLSearchParams(window.location.search).get('file');
        return fileParam ? decodeURIComponent(fileParam) : '';
    });
    const [selectedSource, setSelectedSource] = useState('pat');
    const [selectedContact, setSelectedContact] = useState<ContactOption | null>(null);
    const [phoneNumber, setPhoneNumber] = useState('');
    const [program, setProgram] = useState('WhatsApp');
    const [status, setStatus] = useState<{ type: StatusType; message: string } | null>(null);
    const [authPrompted, setAuthPrompted] = useState(false);
    // One send at a time: a double click used to send every file twice (FE-F16-6).
    const [sending, setSending] = useState(false);

    const fileCount = filePath ? filePath.split(',').filter((p) => p.trim()).length : 0;
    const showAuthRequired = authPrompted && program === 'WhatsApp' && !whatsappClientReady;

    // Contacts come from one of the sources above; only the active one fetches.
    const phonesResult = useQuery({ ...patientPhonesQuery(), enabled: selectedSource === 'pat' });
    const googleResult = useQuery({
        ...googleContactsQuery(selectedSource),
        enabled: selectedSource !== 'pat',
    });
    const activeResult = selectedSource === 'pat' ? phonesResult : googleResult;
    // A patient with no phone can't be sent anything — it used to be listed as "Name - null".
    const contacts: Contact[] =
        selectedSource === 'pat'
            ? (phonesResult.data ?? []).flatMap((c) => (c.phone ? [{ id: c.id, name: c.name, phone: c.phone }] : []))
            : (googleResult.data ?? []).map((c) => ({ id: c.id, name: c.text, phone: c.phone }));
    const contactOptions: ContactOption[] = contacts.map((contact) => ({
        value: contact.id,
        label: `${contact.name} - ${contact.phone}`,
        phone: contact.phone,
    }));

    // Surface a contact-load failure with the status banner, once per error transition.
    const [prevContactsError, setPrevContactsError] = useState(activeResult.isError);
    if (activeResult.isError !== prevContactsError) {
        setPrevContactsError(activeResult.isError);
        if (activeResult.isError) {
            setStatus({
                type: 'error',
                message: `Failed to load contacts: ${httpErrorMessage(activeResult.error, 'Unknown error')}`,
            });
        }
    }

    const handleSourceChange = (newSource: string) => {
        setSelectedSource(newSource);
        setSelectedContact(null);
        setPhoneNumber('');
    };

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

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (sending) return;

        if (!phoneNumber.trim()) {
            setStatus({ type: 'error', message: 'Please enter a phone number' });
            return;
        }

        if (!filePath.trim()) {
            setStatus({ type: 'error', message: 'Please select a file to send' });
            return;
        }

        if (program === 'WhatsApp' && !whatsappClientReady) {
            setStatus(null);
            setAuthPrompted(true);
            return;
        }

        const formData = new FormData();
        formData.append('prog', program);
        formData.append('phone', phoneNumber);
        formData.append('file', filePath);

        setSending(true);
        setStatus(null);
        try {
            const data = await postFormData<SendMediaResult>('/api/wa/sendmedia2', formData, {
                timeoutMs: SEND_TIMEOUT_MS,
            });
            const total = data.total ?? fileCount;
            const sent = data.sentMessages ?? 0;
            const reasons = (data.errors?.length ? data.errors : data.error ? [data.error] : []).join('; ');

            if (total > 0 && sent === total) {
                setStatus({
                    type: 'success',
                    message: `${program} message sent (${sent} of ${total} file${total === 1 ? '' : 's'}).`,
                });
            } else if (sent > 0) {
                setStatus({
                    type: 'warning',
                    message: `Only ${sent} of ${total} files were sent by ${program}${reasons ? ` — ${reasons}` : ''}.`,
                });
            } else {
                setStatus({
                    type: 'error',
                    message: `${program} could not send the file${total === 1 ? '' : 's'}${reasons ? `: ${reasons}` : '.'}`,
                });
            }
        } catch (error) {
            console.error('Error sending message:', error);
            setStatus({
                type: 'error',
                message: `Failed to send ${program} message: ${httpErrorMessage(error, 'Unknown error')}`,
            });
        } finally {
            setSending(false);
        }
    };

    const handleClose = () => {
        if (window.opener) {
            window.close();
        } else {
            navigate('/');
        }
    };

    // `?popup` tells the auth page to close itself after pairing, instead of
    // navigating this popup to the whole /send page (FE-F16-13).
    const openAuthPopup = () => {
        window.open('/auth?popup=1', 'whatsappAuth', 'width=600,height=700,resizable=yes,scrollbars=yes');
    };

    return (
        <div className={styles.page}>
            <form onSubmit={handleSubmit} className={styles.card} aria-busy={sending}>
                <div className={styles.header}>
                    <h2 className={styles.title}>Send Files</h2>
                    <button
                        type="button"
                        onClick={handleClose}
                        className={styles.closeButton}
                        aria-label="Close"
                    >
                        <i className="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                </div>

                {status && (
                    <div className={`${styles.status} ${styles[status.type]}`} role={status.type === 'success' ? 'status' : 'alert'}>
                        {status.message}
                    </div>
                )}

                {showAuthRequired && (
                    <div className={`${styles.status} ${styles.authRequired}`} role="alert">
                        <h3>WhatsApp Authentication Required</h3>
                        <p>The WhatsApp client needs to be paired before files can be sent. This message clears by itself once it is.</p>
                        <div className={styles.authActions}>
                            <button type="button" onClick={openAuthPopup} className="btn btn-primary">
                                <i className="fa-solid fa-qrcode" aria-hidden="true"></i> Open WhatsApp pairing
                            </button>
                        </div>
                    </div>
                )}

                <div className={styles.field}>
                    <label className={styles.label} htmlFor="sendProgram">Send with</label>
                    <select
                        id="sendProgram"
                        value={program}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) => setProgram(e.target.value)}
                        className={styles.select}
                    >
                        <option value="WhatsApp">WhatsApp</option>
                        <option value="Telegram">Telegram</option>
                    </select>
                </div>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor="sendSource">Contacts from</label>
                    <select
                        id="sendSource"
                        value={selectedSource}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) => handleSourceChange(e.target.value)}
                        className={styles.select}
                    >
                        {SOURCES.map((s) => (
                            <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                    </select>
                </div>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor="sendContact">Contact</label>
                    <Select<ContactOption, false>
                        inputId="sendContact"
                        value={selectedContact}
                        onChange={handleContactSelect}
                        options={contactOptions}
                        isSearchable={true}
                        isClearable={true}
                        isLoading={activeResult.isFetching}
                        placeholder="Search and select a contact..."
                        noOptionsMessage={() => 'No contacts found'}
                        classNamePrefix="react-select"
                    />
                </div>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor="sendPhone">Phone number</label>
                    <input
                        id="sendPhone"
                        type="text"
                        inputMode="tel"
                        value={phoneNumber}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setPhoneNumber(e.target.value)}
                        placeholder="e.g. 9647701234567"
                        className={styles.input}
                        required
                    />
                </div>

                <div className={styles.field}>
                    <span className={styles.label}>
                        {fileCount === 1 ? 'File' : `Files (${fileCount})`}
                    </span>
                    {fileCount > 1 ? (
                        <ul className={styles.fileList}>
                            {filePath.split(',').map((p) => p.trim()).filter(Boolean).map((p) => (
                                <li key={p}>{p}</li>
                            ))}
                        </ul>
                    ) : (
                        <input
                            type="text"
                            value={filePath}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setFilePath(e.target.value)}
                            aria-label="File path"
                            className={styles.input}
                            required
                            readOnly
                        />
                    )}
                </div>

                <button type="submit" className={`btn btn-primary ${styles.submit}`} disabled={sending}>
                    {sending ? 'Sending…' : 'Send'}
                </button>
            </form>
        </div>
    );
};

export default SendMessage;
