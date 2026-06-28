/**
 * PhoneDisplay - Displays phone numbers with consistent formatting
 *
 * Usage:
 *   <PhoneDisplay phone="7501234567" />        -> 750 123 4567
 *   <PhoneDisplay phone="751 184 2469" />      -> 751 184 2469
 *   <PhoneDisplay phone="9647501234567" />     -> 750 123 4567
 */

import { formatPhoneForDisplay } from '../../utils/phoneFormatter';

interface PhoneDisplayProps {
  phone: string | null | undefined;
  className?: string;
  /** If true, renders as <a href="tel:..."> for clickable calling */
  asLink?: boolean;
}

const PhoneDisplay = ({ phone, className, asLink = false }: PhoneDisplayProps) => {
  const formatted = formatPhoneForDisplay(phone);

  if (!formatted) return null;

  if (asLink) {
    const cleanDigits = phone?.replace(/[^\d]/g, '') || '';
    return (
      // dir="ltr" isolates the number so its space-separated groups aren't
      // bidi-reordered (reversed) inside an RTL/Arabic layout.
      <a href={`tel:${cleanDigits}`} className={className} dir="ltr">
        {formatted}
      </a>
    );
  }

  return <span className={className} dir="ltr">{formatted}</span>;
};

export default PhoneDisplay;
