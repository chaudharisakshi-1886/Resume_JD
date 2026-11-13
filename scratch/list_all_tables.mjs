import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const tables = await client.query(`
  SELECT table_name 
  FROM information_schema.tables 
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name;
`);
console.log('ALL TABLES IN SUPABASE DATABASE:');
tables.rows.forEach(r => console.log(' - ' + r.table_name));
await client.end();

