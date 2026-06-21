/**
 * ════════════════════════════════════════════════════════════════════════
 *  INPUT VALIDATION   (extracted module)
 * ════════════════════════════════════════════════════════════════════════
 * Boundary input sanitization + schema-driven field validation. Used wherever
 * user-supplied data enters the system (ticket create/update, portal, API).
 *
 * Extracted from Code.gs. GAS shares one global namespace across .gs files, so
 * sanitizeInput() / validateField() remain callable everywhere unchanged.
 *
 * LOAD-ORDER SAFETY: the schema set references Object.values(STATUS_ENUM), which
 * lives in Code.gs. To avoid a temporal-dead-zone error at load (GAS does not
 * guarantee file load order), the schemas are NOT a top-level const — they are
 * built lazily on first use by getValidationSchemas_() and memoized. This module
 * therefore has no load-time dependency on any other file.
 */

/**
 *  INPUT SANITIZATION
 * Prevents injection attacks and data corruption.
 */
function sanitizeInput(input, options = {}) {
  if (input === null || input === undefined) return options.default || '';

  let sanitized = String(input)
    .replace(/\x00/g, '')          // strip null bytes (can bypass filters)
    .replace(/[<>`]/g, '')         // strip HTML/template injection chars
    .replace(/\s+/g, ' ')          // collapse whitespace
    .trim();

  // Limit length before type transforms to avoid over-allocation
  if (options.maxLength && sanitized.length > options.maxLength) {
    sanitized = sanitized.substring(0, options.maxLength).trimEnd();
  }

  // Type-specific normalization
  if (options.type === 'email') {
    sanitized = sanitized.toLowerCase().replace(/[^a-z0-9@._+-]/g, '');
  } else if (options.type === 'id') {
    sanitized = sanitized.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  } else if (options.type === 'number') {
    sanitized = sanitized.replace(/[^0-9.-]/g, '');
  } else if (options.type === 'phone') {
    sanitized = sanitized.replace(/[^0-9+\-(). ]/g, '');
  }

  return sanitized;
}

/**
 * [TICKETS] VALIDATION SCHEMAS — built lazily and memoized.
 * Lazy (not a top-level const) because `status.allowedValues` reads STATUS_ENUM
 * from Code.gs; building at call time removes any cross-file load-order hazard.
 * The returned object is frozen, preserving the original immutability guarantee.
 */
let _validationSchemas_ = null;
function getValidationSchemas_() {
  if (_validationSchemas_) return _validationSchemas_;
  _validationSchemas_ = Object.freeze({
    ticketId: Object.freeze({
      type: 'string',
      required: true,
      minLength: 3,
      maxLength: 50,
      pattern: /^[A-Z0-9-]+$/i,
      sanitize: Object.freeze({ type: 'id', maxLength: 50 })
    }),
    status: Object.freeze({
      type: 'string',
      required: true,
      allowedValues: Object.values(STATUS_ENUM)
    }),
    reason: Object.freeze({
      type: 'string',
      required: false,
      minLength: 3,
      maxLength: 2000,
      sanitize: Object.freeze({ maxLength: 2000 })
    }),
    email: Object.freeze({
      type: 'string',
      required: true,
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      sanitize: Object.freeze({ type: 'email', maxLength: 255 })
    }),
    mid: Object.freeze({
      type: 'string',
      required: true,
      minLength: 1,
      maxLength: 50,
      sanitize: Object.freeze({ type: 'id', maxLength: 50 })
    })
  });
  return _validationSchemas_;
}

/**
 * [OK] VALIDATE INPUT AGAINST SCHEMA
 * @param {*} value - Value to validate
 * @param {string} schemaName - Schema key from getValidationSchemas_()
 * @returns {Object} { valid: boolean, value: sanitized, errors: string[] }
 */
function validateField(value, schemaName) {
  const schema = getValidationSchemas_()[schemaName];
  if (!schema) {
    return { valid: false, value: null, errors: [`Unknown schema: ${schemaName}`] };
  }

  const errors = [];
  let sanitizedValue = value;

  // Sanitize first if schema has sanitize rules
  if (schema.sanitize) {
    sanitizedValue = sanitizeInput(value, schema.sanitize);
  }

  // Required check
  if (schema.required && (!sanitizedValue || sanitizedValue.toString().trim() === '')) {
    errors.push(`${schemaName} is required`);
    return { valid: false, value: null, errors };
  }

  // Skip further validation if empty and not required
  if (!sanitizedValue || sanitizedValue.toString().trim() === '') {
    return { valid: true, value: '', errors: [] };
  }

  const strValue = String(sanitizedValue);

  // Min length
  if (schema.minLength && strValue.length < schema.minLength) {
    errors.push(`${schemaName} must be at least ${schema.minLength} characters`);
  }

  // Max length
  if (schema.maxLength && strValue.length > schema.maxLength) {
    errors.push(`${schemaName} must be at most ${schema.maxLength} characters`);
  }

  // Pattern
  if (schema.pattern && !schema.pattern.test(strValue)) {
    errors.push(`${schemaName} format is invalid`);
  }

  // Allowed values
  if (schema.allowedValues && !schema.allowedValues.includes(strValue)) {
    errors.push(`${schemaName} must be one of: ${schema.allowedValues.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    value: sanitizedValue,
    errors: errors
  };
}
