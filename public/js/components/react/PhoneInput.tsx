/**
 * PhoneInput - Masked phone input that stores clean digits
 *
 * Usage:
 *   <PhoneInput
 *     value={formData.phone}
 *     onChange={(value) => setFormData(prev => ({ ...prev, phone: value }))}
 *   />
 *
 * Display: 750 123 4567 (formatted)
 * Value:   7501234567   (clean digits)
 */

import { IMaskInput } from 'react-imask';
import { PHONE_MASK, PHONE_PLACEHOLDER, cleanPhone } from '../../utils/phoneFormatter';

interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
}

const PhoneInput = ({
  value,
  onChange,
  className = 'form-control',
  placeholder = PHONE_PLACEHOLDER,
  disabled = false,
  name,
  id
}: PhoneInputProps) => {
  return (
    <IMaskInput
      mask={PHONE_MASK}
      value={value}
      unmask={true}
      // IMask fires `accept` when it first formats the value it was given. That is
      // not an edit: reporting it rewrote the form's copy of a number the user had
      // only looked at (audit FE-F6-4), so only a value that differs is passed on.
      onAccept={(next: string) => {
        if (next !== cleanPhone(value)) onChange(next);
      }}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
      name={name}
      id={id}
      // Keep digit groups + caret left-to-right even inside an RTL/Arabic form.
      dir="ltr"
    />
  );
};

export default PhoneInput;
