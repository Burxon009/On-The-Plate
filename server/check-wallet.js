const { pool } = require("./dist/db");

async function check() {
  try {
    const wallets = await pool.query(`
      SELECT
        w.id,
        w.user_id,
        w.balance,
        w.store_id,
        w.created_at,
        w.updated_at
      FROM wallets w
      ORDER BY w.id
    `);

    console.log("=== WALLETS ===");
    console.table(wallets.rows);

    const links = await pool.query(`
      SELECT
        us.user_id,
        us.store_id,
        s.name AS store_name
      FROM user_stores us
      JOIN stores s ON s.id = us.store_id
      ORDER BY us.user_id, us.store_id
    `);

    console.log("=== USER STORES ===");
    console.table(links.rows);
  } catch (error) {
    console.error(error);
  } finally {
    await pool.end();
  }
}

check();