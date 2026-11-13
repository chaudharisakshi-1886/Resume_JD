import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const m = await client.query('SELECT * FROM _prisma_migrations');
  console.log('MIGRATIONS:', m.rows);
} catch (e) {
  console.log('Error querying _prisma_migrations:', e.message);
}

try {
  const c = await client.query('SELECT count(*) FROM candidate1');
  console.log('candidate1 count:', c.rows[0]);
} catch (e) {
  console.log('Error querying candidate1:', e.message);
}
await client.end();

