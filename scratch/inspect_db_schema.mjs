import 'dotenv/config';
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  connectionString: process.env.DATABASE_URL
});

await client.connect();

async function checkTable(tableName) {
  const res = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, [tableName]);
  console.log(`\n=== Table: "${tableName}" (${res.rows.length} columns) ===`);
  res.rows.forEach(r => console.log(`  ${r.column_name} (${r.data_type}, nullable: ${r.is_nullable})`));
}

for (const t of ['User', 'job_descriptions', 'candidate1', 'Assessment', 'QuestionBank', 'Slot', 'SlotBooking', 'output1']) {
  await checkTable(t);
}

await client.end();

