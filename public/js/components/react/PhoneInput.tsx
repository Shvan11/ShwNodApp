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
import { PHONE_MASK, PHONE_PLACEHOLDER } from '../../utils/phoneFormatter';

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
      onAccept={onChange}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
      name={name}
      id={id}
    />
  );
};

export default PhoneInput;
