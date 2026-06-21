/**
 * ════════════════════════════════════════════════════════════════════════
 *  CSV HELPERS   (extracted module)
 * ════════════════════════════════════════════════════════════════════════
 * Shared CSV-encoding primitives used by every export path (call history,
 * tickets, update history, agent/ticket report builders). Pure functions, no
 * top-level dependencies — load-order safe in any file position.
 *
 * csvSafeCell_ also neutralizes CSV/spreadsheet formula injection: a value that
 * starts with = + - or @ is prefixed with a single quote so a spreadsheet opening
 * the export cannot execute it as a formula. This is a security control, not just
 * formatting — keep it on every export.
 *
 * Extracted from Code.gs. GAS shares one global namespace across .gs files, so
 * csvSafeCell_() / csvRow_() remain callable from the export builders unchanged.
 */

function csvSafeCell_(value) {
  const raw = String(value == null ? '' : value);
  const sanitized = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return (sanitized.includes(',') || sanitized.includes('"') || sanitized.includes('\n'))
    ? `"${sanitized.replace(/"/g, '""')}"`
    : sanitized;
}

function csvRow_(values) {
  return values.map(csvSafeCell_).join(',');
}
