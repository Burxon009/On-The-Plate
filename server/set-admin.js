const { pool } = require("./dist/db");

async function main() {
  try {
    await pool.query(
      "UPDATE users SET role = 'admin' WHERE id = $1",
      [2]
    );

    const result = await pool.query(
      "SELECT id, phone, name, role FROM users WHERE id = $1",
      [2]
    );

    console.table(result.rows);

    console.log("✅ Пользователь 2 теперь ADMIN");
  } catch (error) {
    console.error("❌ Ошибка:", error);
  } finally {
    await pool.end();
  }
}

main();