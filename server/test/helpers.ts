import type { NextFunction, Request, Response } from "express";

export interface MockRes {
  statusCode: number;
  body: unknown;
  status(code: number): MockRes;
  json(payload: unknown): MockRes;
}

export function mockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

/**
 * req с безопасными дефолтами. storeAdminMiddleware читает
 * req.params.storeId напрямую (без ?.), поэтому params всегда объект.
 */
export function mockReq(overrides: Partial<Request> & { user?: { userId: number; role: string } } = {}) {
  return {
    params: {},
    body: {},
    query: {},
    headers: {},
    ...overrides,
  } as unknown as Request & { user?: { userId: number; role: string } };
}

export function mockNext() {
  let called = false;
  const fn = (() => {
    called = true;
  }) as NextFunction & { called: boolean };
  Object.defineProperty(fn, "called", { get: () => called });
  return fn;
}
