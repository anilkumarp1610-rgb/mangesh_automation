import type { RequestHandler } from 'express';

/**
 * Auth seam. v1 has no authentication (SSO is a later phase). Every request is
 * treated as an anonymous service user. When SSO lands, validate the token /
 * session here and populate req.user — no route handler should need to change.
 */
export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const authenticate: RequestHandler = (req, _res, next) => {
  req.user = { id: 'anonymous', email: null, name: 'Anonymous' };
  next();
};
