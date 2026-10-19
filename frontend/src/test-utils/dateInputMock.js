/**
 * Serialize a mocked date-only input with browser-local calendar parts.
 *
 * DateInput represents a calendar date, not an instant. Using toISOString()
 * here can shift the displayed day in time zones ahead of UTC.
 */
export const formatLocalCalendarDateInput = value => {
  if (!value) return '';
  if (!(value instanceof Date)) return value;

  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Parse an HTML date input as local midnight instead of UTC midnight.
 *
 * The built-in Date parser treats YYYY-MM-DD as UTC, which can shift the
 * calendar day in time zones behind UTC.
 */
export const parseLocalCalendarDateInput = value => {
  if (!value) return null;

  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};
