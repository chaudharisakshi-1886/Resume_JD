import 'dotenv/config';
import fs from 'fs';
import pg from 'pg';
const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const sql = fs.readFileSync('prisma/create_all_tables.sql', 'utf8');
console.log('Executing create_all_tables.sql against Supabase...');
await client.query(sql);
console.log('SUCCESS! All tables and enums created.');

const check = await client.query(`
  SELECT table_name 
  FROM information_schema.tables 
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name;
`);
console.log('\nVerified tables created in public schema:');
check.rows.forEach(r => console.log(' - ' + r.table_name));

await client.end();

