import type { Request, Response, NextFunction } from "express";

export function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const token = req.headers.authorization;
  if (token) {
    next();
  }
}

export const AUTH_HEADER = "Authorization";
