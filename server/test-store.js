const { pool } = require("./dist/db");

async function createStore() {
  try {
    const result = await pool.query(`
      INSERT INTO stores (
        name,
        description,
        primary_color
      )
      VALUES (
        'Test Store',
        'Тестовый магазин',
        '#7C3AED'
      )
      RETURNING id, name;
    `);

    console.log("Магазин создан:");
    console.log(result.rows[0]);
  } catch (error) {
    console.error("Ошибка:", error);
  } finally {
    await pool.end();
  }
}

createStore();