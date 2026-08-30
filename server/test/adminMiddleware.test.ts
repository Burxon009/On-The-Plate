import { describe, expect, it } from "vitest";
import { adminMiddleware } from "../src/adminMiddleware";
import { mockNext, mockReq, mockRes } from "./helpers";

// Чистая проверка условий, БД не трогает — мокаем req/res/next.
describe("adminMiddleware", () => {
  it("пропускает пользователя с ролью admin", () => {
    const req = mockReq({ user: { userId: 1, role: "admin" } });
    const res = mockRes();
    const next = mockNext();

    adminMiddleware(req, res as never, next);

    expect(next.called).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it("блокирует не-admin с 403", () => {
    const req = mockReq({ user: { userId: 2, role: "client" } });
    const res = mockRes();
    const next = mockNext();

    adminMiddleware(req, res as never, next);

    expect(next.called).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ message: "Доступ только для администратора" });
  });

  it("блокирует запрос без req.user с 401", () => {
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    adminMiddleware(req, res as never, next);

    expect(next.called).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ message: "Требуется авторизация" });
  });
});
