/**
 * Telegram share modal — pick a contact (or type a phone), then push the given
 * file(s) to it over Telegram.
 *
 * Mirrors the Send Message screen's recipient picker (Patients' Phones / Dr.
 * Shwan / Clinic sources + a searchable dropdown + free-text phone), but is
 * driven off a `ShareSource[]` like the LocalSend modal so single + batch share
 * are one code path. The server resolves the refs to disk paths and does the
 * MTProto upload; this modal just gathers the recipient and fires the request.
 * All I/O goes through the core/http funnel (reads carry `{ schema }`).
 */
import { useCallback, useEffect, useState } from 'react';
import Select, { type SingleValue, type StylesConfig } from 'react-select';
import { useQuery } from '@tanstack/react-query';
import Modal from '../Modal';
import ModalHeader from '../ModalHeader';
import { useToast } from '@/contexts/ToastContext';
import { postJSON, httpErrorMessage } from '@/core/http';
import { patientPhonesQuery, googleContactsQuery, telegramStatusQuery } from '@/query/queries';
import * as telegram from '@shared/contracts/telegram.contract';
import type { ShareSource } from '../localsend/LocalSendShareModal';
import styles from './TelegramShareModal.module.css';

interface Props {
  open: boolean;
  sources: ShareSource[];
  onClose: () => void;
}

interface ContactData {
  id?: string | number;
  phone?: string;
  name?: string;
  text?: string;
  [key: string]: unknown;
}

interface ContactOption {
  value: string | number;
  label: string;
  phone: string;
}

type Source = 'pat' | 'shw' | 'cli';

const SOURCE_LABELS: Record<Source, string> = {
  pat: "Patients' Phones",
  shw: 'Dr. Shwan Phone',
  cli: 'Clinic Phone',
};

const selectStyles: StylesConfig<ContactOption, false> = {
  menu: (provided) => ({ ...provided, zIndex: 9999 }),
};

const TelegramShareModal = ({ open, sources, onClose }: Props) => {
  const toast = useToast();

  const [source, setSource] = useState<Source>('pat');
  const [selected, setSelected] = useState<ContactOption | null>(null);
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);

  // Telegram availability — a status hiccup shouldn't block the UI, so a failed
  // read falls back to "enabled".
  const statusResult = useQuery({ ...telegramStatusQuery(), enabled: open });
  const enabled = statusResult.data?.enabled ?? true;

  // Contacts come from the patients' phone book (`pat`) or a Google contact group
  // (`shw`/`cli`); only the active source fetches while the modal is open.
  const phonesResult = useQuery({ ...patientPhonesQuery(), enabled: open && source === 'pat' });
  const googleResult = useQuery({
    ...googleContactsQuery(source),
    enabled: open && source !== 'pat',
  });
  const activeResult = source === 'pat' ? phonesResult : googleResult;
  const options: ContactOption[] = ((activeResult.data ?? []) as ContactData[])
    .filter((c) => c.phone)
    .map((c) => ({
      value: c.id ?? (c.phone as string),
      label: `${c.name || c.text || ''} - ${c.phone}`,
      phone: c.phone as string,
    }));

  // Reset recipient state whenever the modal opens. Adjust-during-render keyed on
  // the open state so a fresh open re-seeds the picker without a
  // setState-in-effect bailout.
  const [openedKey, setOpenedKey] = useState(open);
  if (open !== openedKey) {
    setOpenedKey(open);
    if (open) {
      setSource('pat');
      setSelected(null);
      setPhone('');
    }
  }

  // Surface a contact-load failure (the status read intentionally stays silent).
  useEffect(() => {
    if (activeResult.isError) {
      toast.error(httpErrorMessage(activeResult.error, 'Failed to load contacts'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeResult.isError, activeResult.error]);

  const handleSourceChange = (src: Source): void => {
    setSource(src);
    setSelected(null);
    setPhone('');
  };

  // Prefill the phone input from a picked contact (same shaping as Send Message).
  const handleSelect = (opt: SingleValue<ContactOption>): void => {
    setSelected(opt);
    if (!opt?.phone) {
      setPhone('');
      return;
    }
    if (source === 'pat') {
      setPhone('964' + opt.phone);
      return;
    }
    const match = opt.phone.match(/(?:(?:(?:00)|\+)(?:964)|0)[ ]?(\d{3})[ ]?(\d{3})[ ]?(\d{4})/);
    setPhone(match ? '964' + match[1] + match[2] + match[3] : opt.phone);
  };

  const handleSend = useCallback(async (): Promise<void> => {
    if (!phone.trim() || sources.length === 0) return;
    setSending(true);
    try {
      const result = await postJSON<telegram.SendResponse>(
        '/api/telegram/send',
        { phone: phone.trim(), files: sources },
        { schema: telegram.send.response }
      );
      if (result.sent === result.total) {
        toast.success(`Sent ${result.sent} file(s) via Telegram`);
        onClose();
      } else if (result.sent > 0) {
        toast.warning(`Sent ${result.sent}/${result.total}; ${result.errors[0] ?? 'some failed'}`);
      } else {
        toast.error(result.errors[0] || 'Telegram send failed');
      }
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Telegram send failed'));
    } finally {
      setSending(false);
    }
  }, [phone, sources, toast, onClose]);

  if (!open) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabelledBy="telegram-share-title"
      contentClassName={styles.modal}
      overlayClassName={styles.overlay}
    >
      <ModalHeader
        variant="info"
        titleId="telegram-share-title"
        icon={<i className="fab fa-telegram" aria-hidden="true" />}
        title="Share via Telegram"
        onClose={onClose}
      />

      <div className={styles.body}>
        {!enabled && (
          <p className={styles.notice}>
            Telegram is not configured on the server. Set the Telegram API credentials and session to
            use it.
          </p>
        )}

        <span className={styles.subtle}>
          {sources.length === 1 ? '1 file' : `${sources.length} files`}
        </span>

        {/* Recipient source */}
        <select
          className={styles.sourceSelect}
          value={source}
          onChange={(e) => handleSourceChange(e.target.value as Source)}
          disabled={!enabled}
        >
          {(Object.keys(SOURCE_LABELS) as Source[]).map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </select>

        {/* Contact picker */}
        <Select<ContactOption, false>
          value={selected}
          onChange={handleSelect}
          options={options}
          isSearchable
          isClearable
          isDisabled={!enabled}
          placeholder="Search and select a contact…"
          noOptionsMessage={() => 'No contacts found'}
          classNamePrefix="react-select"
          styles={selectStyles}
        />

        {/* Phone (editable, prefilled from the contact) */}
        <input
          className={styles.phoneInput}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone number (e.g. 9647XXXXXXXX)"
          inputMode="tel"
          disabled={!enabled}
        />

        <div className={styles.footer}>
          <button type="button" className={styles.toolButton} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => void handleSend()}
            disabled={!enabled || sending || !phone.trim()}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default TelegramShareModal;
