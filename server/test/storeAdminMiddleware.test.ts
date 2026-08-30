import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db";
import { storeAdminMiddleware } from "../src/storeAdminMiddleware";
import { mockNext, mockReq, mockRes } from "./helpers";

/**
 * storeAdminMiddleware сам делает SELECT из store_admins, поэтому req/res/next
 * мокаем, но привязку admin↔store читаем из реальной тестовой БД.
 */

// Предохранитель: тесты делают TRUNCATE — убеждаемся, что это тестовая БД.
beforeAll(async () => {
  const { rows } = await pool.query("SELECT current_database() AS db");
  if (rows[0].db !== "ucafe_loyalty_test") {
    throw new Error(
      `Тесты подключены к БД "${rows[0].db}", ожидалась "ucafe_loyalty_test". Прерываю.`
    );
  }
});

async function seedAdminForStore() {
  const store = await pool.query(
    `INSERT INTO stores (name, cashback_percent, is_active)
     VALUES ('Store A', 1.00, TRUE) RETURNING id`
  );
  const storeId: number = store.rows[0].id;

  const user = await pool.query(
    `INSERT INTO users (name, role) VALUES ('Admin A', 'admin') RETURNING id`
  );
  const adminId: number = user.rows[0].id;

  await pool.query(
    `INSERT INTO store_admins (user_id, store_id) VALUES ($1, $2)`,
    [adminId, storeId]
  );

  return { adminId, storeId };
}

afterEach(async () => {
  await pool.query("TRUNCATE users, stores RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("storeAdminMiddleware", () => {
  it("пропускает admin'а к его собственному магазину", async () => {
    const { adminId, storeId } = await seedAdminForStore();
    const req = mockReq({ user: { userId: adminId, role: "admin" }, body: { storeId } });
    const res = mockRes();
    const next = mockNext();

    await storeAdminMiddleware(req, res as never, next as never);

    expect(next.called).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it("отдаёт 403, если admin лезет в чужой магазин (999)", async () => {
    const { adminId } = await seedAdminForStore();
    const req = mockReq({ user: { userId: adminId, role: "admin" }, body: { storeId: 999 } });
    const res = mockRes();
    const next = mockNext();

    await storeAdminMiddleware(req, res as never, next as never);

    expect(next.called).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ message: "У вас нет доступа к этому магазину" });
  });

  it("отдаёт 400, если storeId вообще не передан", async () => {
    const { adminId } = await seedAdminForStore();
    const req = mockReq({ user: { userId: adminId, role: "admin" } }); // ни params, ни body, ни query
    const res = mockRes();
    const next = mockNext();

    await storeAdminMiddleware(req, res as never, next as never);

    expect(next.called).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ message: "Некорректный или отсутствующий storeId" });
  });

  it("отдаёт 400, если storeId — некорректное значение ('abc')", async () => {
    const { adminId } = await seedAdminForStore();
    const req = mockReq({ user: { userId: adminId, role: "admin" }, body: { storeId: "abc" } });
    const res = mockRes();
    const next = mockNext();

    await storeAdminMiddleware(req, res as never, next as never);

    expect(next.called).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ message: "Некорректный или отсутствующий storeId" });
  });

  it("отдаёт 401, если req.user не заполнен (authMiddleware не отработал)", async () => {
    const req = mockReq({ body: { storeId: 1 } });
    const res = mockRes();
    const next = mockNext();

    await storeAdminMiddleware(req, res as never, next as never);

    expect(next.called).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});
