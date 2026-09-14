/**
 * zod-backed request validation. Server-side always — the client's own checks
 * are UX only and are never trusted.
 */
import { z } from 'zod';

export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const fields = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!fields[key]) fields[key] = issue.message;
      }
      return res.status(400).json({
        error: 'Please check the highlighted fields.',
        code: 'VALIDATION',
        fields,
      });
    }
    // Express 5 makes req.query a getter, so assign to a parallel property.
    if (source === 'query') req.validatedQuery = result.data;
    else req[source] = result.data;
    next();
  };
}

/**
 * Build a PATCH-style schema: every field optional, and every `.default()`
 * stripped.
 *
 * Plain `.partial()` keeps defaults, so parsing `{ title: 'x' }` also yields
 * `category: 'clinic'`, `is_published: false` and so on — a one-field update
 * would silently rewrite fields the caller never sent. Unwrapping the defaults
 * makes an absent key genuinely mean "leave this alone".
 */
export function partialUpdate(schema) {
  const shape = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    let inner = field;
    // Unwrap nested ZodDefault wrappers (e.g. .default().optional()).
    while (inner?.def?.innerType && inner.constructor.name === 'ZodDefault') {
      inner = inner.def.innerType;
    }
    shape[key] = inner.optional();
  }
  return z.object(shape);
}

/* Reusable primitives */
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.');
export const zTime = z.string().regex(/^\d{2}:\d{2}$/, 'Use a valid time.');
export const zPhone = z.string().trim().min(10, 'Enter a valid mobile number.').max(20);
export const zName = z.string().trim().min(2, 'Please enter your name.').max(120);
export const zEmail = z.string().trim().email('Enter a valid email address.').max(200);
export const zId = z.coerce.number().int().positive();
export const zBool = z.union([z.boolean(), z.literal('true'), z.literal('false'), z.literal(0), z.literal(1), z.literal('0'), z.literal('1')])
  .transform(v => v === true || v === 'true' || v === 1 || v === '1');
export const zMinutes = z.coerce.number().int().min(0).max(1439);
export const zText = (max = 2000) => z.string().trim().max(max);
export { z };
