import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL
});

await client.connect();

const fks = await client.query(`
  SELECT
    tc.table_name, 
    kcu.column_name, 
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name 
  FROM 
    information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='public';
`);

console.log('Foreign keys in Supabase:');
fks.rows.forEach(r => console.log(`  ${r.table_name}.${r.column_name} -> ${r.foreign_table_name}.${r.foreign_column_name}`));

await client.end();

