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
 * @param originalFilename - Original filename
 * @returns Phone-compatible filename
 */
export function getPhoneCompatibleFilename(originalFilename: string): string {
  // Extract extension from filename
  const extension = originalFilename.slice(-3);

  // Default to original name with jpg extension
  const defaultName = `${originalFilename.split('.')[0]}.jpg`;

  return fileNameMap[extension] || defaultName;
}

export default { getPhoneCompatibleFilename };
