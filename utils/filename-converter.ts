/**
 * Filename Converter Utility
 * Convert filename to phone-compatible .jpg format
 * Shared utility for both WhatsApp and Telegram messaging
 */

/**
 * Map of extension codes to descriptive names
 */
const fileNameMap: Record<string, string> = {
  'i10': 'Profile.jpg',
  'i12': 'Rest.jpg',
  'i13': 'Smile.jpg',
  'i23': 'Upper.jpg',
  'i24': 'Lower.jpg',
  'i20': 'Right.jpg',
  'i22': 'Center.jpg',
  'i21': 'Left.jpg'
};

/**
 * Convert filename to phone-compatible .jpg format
 *
 * A Dolphin timepoint image is `<something>.i13`, so the 3-character tail is the
 * view code and maps to a friendly name. Anything else keeps its base name and
 * gains a `.jpg` extension — the base name is everything before the LAST dot, so
 * `patient.record.i99` stays `patient.record.jpg` instead of being cut down to
 * `patient.jpg` at the first dot.
 *
 * @param originalFilename - Original filename
 * @returns Phone-compatible filename
 */
export function getPhoneCompatibleFilename(originalFilename: string): string {
  // Extract extension from filename
  const extension = originalFilename.slice(-3);
  const mapped = fileNameMap[extension];
  if (mapped) return mapped;

  const lastDot = originalFilename.lastIndexOf('.');
  const baseName = lastDot > 0 ? originalFilename.slice(0, lastDot) : originalFilename;
  return `${baseName}.jpg`;
}

export default { getPhoneCompatibleFilename };
