export const MIN_BAR_FONT = 10;

/** Largest readable integer size that fits; clipping remains at the minimum. */
export function fittingBarFont(maximum: number, fits: (size: number) => boolean): number {
  const max = Math.max(MIN_BAR_FONT, Math.floor(maximum));
  let lo = MIN_BAR_FONT, hi = max, result = MIN_BAR_FONT;
  while (lo <= hi) {
    const size = Math.floor((lo + hi) / 2);
    if (fits(size)) { result = size; lo = size + 1; } else hi = size - 1;
  }
  return result;
}
