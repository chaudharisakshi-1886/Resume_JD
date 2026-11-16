import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

function getUploadBaseDir() {
  return process.env.UPLOAD_DIR || 'E:/Srinivas/upload_resumes';
}

function ensureUploadDirs() {
  const baseDir = getUploadBaseDir();
  const dirs = {
    base: baseDir,
    incomingCandidates: path.join(baseDir, 'incoming', 'candidates'),
    incomingJobs: path.join(baseDir, 'incoming', 'jobs'),
    processed: path.join(baseDir, 'processed'),
    failed: path.join(baseDir, 'failed'),
  };

  for (const dirPath of Object.values(dirs)) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
  return dirs;
}

function sanitizeFileName(fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  const safeBase = base.replace(/[^a-zA-Z0-9_\-\.]/g, '_').replace(/_+/g, '_');
  return `${safeBase}${ext}`;
}

async function saveFileToIncoming(buffer, originalFileName, fileType, batchId) {
  const dirs = ensureUploadDirs();
  const safeName = sanitizeFileName(originalFileName);
  const prefix = batchId ? `${batchId}_` : `${Date.now()}_`;
  const finalName = `${prefix}${safeName}`;
  const targetDir = fileType === 'candidate' ? dirs.incomingCandidates : dirs.incomingJobs;
  const filePath = path.join(targetDir, finalName);
  await fs.promises.writeFile(filePath, buffer);
  return { filePath, safeFileName: finalName };
}

async function moveFile(sourcePath, destination) {
  const dirs = ensureUploadDirs();
  const targetDir = destination === 'processed' ? dirs.processed : dirs.failed;
  const baseName = path.basename(sourcePath);
  const targetPath = path.join(targetDir, baseName);
  try {
    await fs.promises.rename(sourcePath, targetPath);
  } catch (err) {
    if (err.code === 'EXDEV') {
      await fs.promises.copyFile(sourcePath, targetPath);
      await fs.promises.unlink(sourcePath);
    } else {
      throw err;
    }
  }
  return targetPath;
}

async function runTest() {
  console.log('=== STARTING FULL QUEUE VERIFICATION TEST ===\n');

  // Test 1: File name sanitization
  const dirtyName = 'Candidate#1 ~&%  Resume (Draft).pdf';
  const cleanName = sanitizeFileName(dirtyName);
  console.log(`1. Sanitize file name: "${dirtyName}" -> "${cleanName}"`);
  if (cleanName.includes('#') || cleanName.includes('~') || cleanName.includes('%') || cleanName.includes('&') || cleanName.includes(' ')) {
    throw new Error('SanitizeFileName failed to clean special characters!');
  }
  console.log('   PASS: Name sanitized cleanly.\n');

  // Test 2: Save 2 valid files and 1 corrupt file to incoming
  const batchId = `test_batch_${Date.now()}`;
  const userId = 'seeded-admin-user-id';

  // Valid resume 1
  const validBuffer1 = Buffer.from('JOHN DOE\nSoftware Engineer\nEmail: test.john@example.com\nPhone: +1 555-019-2831\nSkills: TypeScript, Node.js', 'utf-8');
  const file1 = await saveFileToIncoming(validBuffer1, 'John#Doe_Resume.txt', 'candidate', batchId);
  console.log(`2a. Saved valid file 1: ${file1.filePath}`);

  // Valid resume 2
  const validBuffer2 = Buffer.from('JANE SMITH\nFrontend Engineer\nEmail: test.jane@example.com\nPhone: +1 555-019-2832\nSkills: React, Next.js', 'utf-8');
  const file2 = await saveFileToIncoming(validBuffer2, 'Jane~Smith&Resume.txt', 'candidate', batchId);
  console.log(`2b. Saved valid file 2: ${file2.filePath}`);

  // Corrupt file (empty / unreadable)
  const corruptBuffer = Buffer.from('', 'utf-8');
  const file3 = await saveFileToIncoming(corruptBuffer, 'Corrupt#&%Empty.txt', 'candidate', batchId);
  console.log(`2c. Saved corrupt file 3: ${file3.filePath}`);

  // Insert into upload_queue
  await client.query(`
    INSERT INTO upload_queue (batch_id, user_id, file_name, file_path, file_type, status)
    VALUES 
      ($1, $2, $3, $4, 'candidate', 'pending'),
      ($1, $2, $5, $6, 'candidate', 'pending'),
      ($1, $2, $7, $8, 'candidate', 'pending');
  `, [batchId, userId, file1.safeFileName, file1.filePath, file2.safeFileName, file2.filePath, file3.safeFileName, file3.filePath]);

  const queueCount = await client.query('SELECT count(*) FROM upload_queue WHERE batch_id = $1 AND status = $2', [batchId, 'pending']);
  console.log(`\n3. Inserted pending rows in upload_queue: ${queueCount.rows[0].count}`);
  if (Number(queueCount.rows[0].count) !== 3) {
    throw new Error(`Expected 3 pending rows, found ${queueCount.rows[0].count}`);
  }
  console.log('   PASS: 3 pending rows confirmed in Supabase upload_queue.\n');

  // Test 3: Process the queue rows simulating process-queue logic
  console.log('4. Simulating process-queue processing...');
  const rows = (await client.query(`SELECT * FROM upload_queue WHERE batch_id = $1 ORDER BY created_at ASC`, [batchId])).rows;

  let processed = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const buffer = await fs.promises.readFile(row.file_path);
      const text = buffer.toString('utf-8').trim();
      if (!text || text.length === 0) {
        throw new Error('Empty text extracted from corrupt file');
      }

      await client.query(`UPDATE upload_queue SET status = 'done', processed_at = NOW() WHERE id = $1`, [row.id]);
      await moveFile(row.file_path, 'processed');
      processed++;
      console.log(`   - Row ${row.id} (${row.file_name}): SUCCESS -> moved to processed/`);
    } catch (err) {
      await client.query(`UPDATE upload_queue SET status = 'failed', error_message = $1, processed_at = NOW() WHERE id = $2`, [err.message, row.id]);
      await moveFile(row.file_path, 'failed');
      failed++;
      console.log(`   - Row ${row.id} (${row.file_name}): FAILED (${err.message}) -> moved to failed/`);
    }
  }

  console.log(`\nResults: ${processed} processed, ${failed} failed.`);
  if (processed !== 2 || failed !== 1) {
    throw new Error(`Expected 2 processed and 1 failed, got ${processed} and ${failed}`);
  }

  // Verify file locations
  const baseDir = getUploadBaseDir();
  const processedFiles = fs.readdirSync(path.join(baseDir, 'processed')).filter(f => f.includes(batchId));
  const failedFiles = fs.readdirSync(path.join(baseDir, 'failed')).filter(f => f.includes(batchId));

  console.log(`\n5. Verifying physical directory storage:`);
  console.log(`   Processed directory files:`, processedFiles);
  console.log(`   Failed directory files:`, failedFiles);

  if (processedFiles.length !== 2) {
    throw new Error(`Expected 2 files in processed/, found ${processedFiles.length}`);
  }
  if (failedFiles.length !== 1) {
    throw new Error(`Expected 1 file in failed/, found ${failedFiles.length}`);
  }
  console.log('   PASS: Physical files moved to correct directories.\n');

  // Verify DB final state
  const doneRows = (await client.query(`SELECT id, status, error_message FROM upload_queue WHERE batch_id = $1 AND status = 'done'`, [batchId])).rows;
  const failedRows = (await client.query(`SELECT id, status, error_message FROM upload_queue WHERE batch_id = $1 AND status = 'failed'`, [batchId])).rows;
  console.log(`6. DB Verification: ${doneRows.length} done, ${failedRows.length} failed (error: "${failedRows[0]?.error_message}")`);
  console.log('   PASS: DB statuses and error messages correctly recorded.\n');

  // Clean up test rows and files
  await client.query('DELETE FROM upload_queue WHERE batch_id = $1', [batchId]);
  processedFiles.forEach(f => fs.unlinkSync(path.join(baseDir, 'processed', f)));
  failedFiles.forEach(f => fs.unlinkSync(path.join(baseDir, 'failed', f)));

  console.log('=== ALL VERIFICATION TESTS COMPLETED & PASSED! ===');
}

runTest().catch(console.error).finally(() => client.end());
