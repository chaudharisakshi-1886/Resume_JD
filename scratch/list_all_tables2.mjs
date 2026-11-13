import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const tables = await client.query(`
  SELECT table_schema, table_name 
  FROM information_schema.tables 
  WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  ORDER BY table_schema, table_name;
`);
console.log('ALL TABLES ACROSS SCHEMAS:');
tables.rows.forEach(r => console.log(` [${r.table_schema}] ${r.table_name}`));
await client.end();

