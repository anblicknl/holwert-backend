/**
 * Utility functions for color manipulation and detection
 */

/**
 * Converts a hex color to RGB values
 * @param hex - Hex color string (e.g., "#FF0000" or "FF0000")
 * @returns RGB object with r, g, b values
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  // Remove # if present
  const cleanHex = hex.replace('#', '');
  
  // Handle 3-digit hex
  if (cleanHex.length === 3) {
    const r = parseInt(cleanHex[0] + cleanHex[0], 16);
    const g = parseInt(cleanHex[1] + cleanHex[1], 16);
    const b = parseInt(cleanHex[2] + cleanHex[2], 16);
    return { r, g, b };
  }
  
  // Handle 6-digit hex
  if (cleanHex.length === 6) {
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    return { r, g, b };
  }
  
  return null;
}

/**
 * Calculates the relative luminance of a color
 * @param r - Red value (0-255)
 * @param g - Green value (0-255)
 * @param b - Blue value (0-255)
 * @returns Luminance value (0-1)
 */
export function getLuminance(r: number, g: number, b: number): number {
  // Convert to relative luminance using WCAG formula
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Determines if a color is light or dark
 * @param hex - Hex color string
 * @returns true if the color is light, false if dark
 */
export function isLightColor(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return true; // Default to light if parsing fails

  const luminance = getLuminance(rgb.r, rgb.g, rgb.b);
  // Strenger: alleen echt heel lichte kleuren gelden als "licht"
  // zodat tekst in de meeste gevallen wit is
  return luminance >= 0.8; // was 0.5
}

/**
 * Gets the appropriate text color (black or white) for a given background color
 * @param backgroundColor - Hex color string
 * @returns "#000000" for light backgrounds, "#FFFFFF" for dark backgrounds
 */
export function getContrastTextColor(backgroundColor: string): string {
  return isLightColor(backgroundColor) ? "#000000" : "#FFFFFF";
}

/**
 * Gets the appropriate text color with custom options
 * @param backgroundColor - Hex color string
 * @param lightTextColor - Color to use for dark backgrounds (default: "#FFFFFF")
 * @param darkTextColor - Color to use for light backgrounds (default: "#000000")
 * @returns Appropriate text color
 */
export function getTextColor(
  backgroundColor: string, 
  lightTextColor: string = "#FFFFFF", 
  darkTextColor: string = "#000000"
): string {
  return isLightColor(backgroundColor) ? darkTextColor : lightTextColor;
}
