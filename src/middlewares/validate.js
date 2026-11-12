import { badRequest } from '../lib/errors.js';

/**
 * validate({ body, query, params }) — zod schemas. Parsed values replace the
 * originals (req.query is a getter in Express 5, so it goes to req.valid).
 */
export const validate = (schemas) => (req, _res, next) => {
  req.valid = {};
  for (const key of ['params', 'query', 'body']) {
    if (!schemas[key]) continue;
    const result = schemas[key].safeParse(req[key] ?? {});
    if (!result.success) {
      return next(
        badRequest(`Invalid ${key}`, result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))),
      );
    }
    req.valid[key] = result.data;
  }
  next();
};
