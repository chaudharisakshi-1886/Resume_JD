import 'dotenv/config';
import pg from 'pg';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const res = await client.query(`SELECT id, email, role FROM "User" WHERE role = 'ADMIN' LIMIT 5`);
console.log('Admins found:', res.rows);
await client.end();

