import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/errors.js";
import {
  readCompanySession,
  readEmployeeSession,
  type CompanySession,
  type EmployeeSession
} from "../services/authService.js";

export function requireCompanySession(req: Request, res: Response, next: NextFunction) {
  const session = readCompanySession(req);
  if (!session) {
    return next(new ApiError(401, "Employer authentication required"));
  }
  res.locals.companySession = session;
  next();
}

export function requireEmployeeSession(req: Request, res: Response, next: NextFunction) {
  const session = readEmployeeSession(req);
  if (!session) {
    return next(new ApiError(401, "Employee authentication required"));
  }
  res.locals.employeeSession = session;
  next();
}

export function attachSessions(req: Request, res: Response, next: NextFunction) {
  const companySession = readCompanySession(req);
  const employeeSession = readEmployeeSession(req);

  if (companySession) {
    res.locals.companySession = companySession;
  }

  if (employeeSession) {
    res.locals.employeeSession = employeeSession;
  }

  next();
}

export function getCompanySession(res: Response) {
  return res.locals.companySession as CompanySession | undefined;
}

export function getEmployeeSession(res: Response) {
  return res.locals.employeeSession as EmployeeSession | undefined;
}

export function assertCompanyScope(res: Response, companyId: string) {
  const session = getCompanySession(res);
  if (!session) {
    throw new ApiError(401, "Employer authentication required");
  }
  if (session.companyId !== companyId) {
    throw new ApiError(403, "This company session cannot access that workspace");
  }
  return session;
}

export function assertEmployeeScope(res: Response, employeeId: string) {
  const session = getEmployeeSession(res);
  if (!session) {
    throw new ApiError(401, "Employee authentication required");
  }
  if (session.employeeId !== employeeId) {
    throw new ApiError(403, "This employee session cannot access that workspace");
  }
  return session;
}
