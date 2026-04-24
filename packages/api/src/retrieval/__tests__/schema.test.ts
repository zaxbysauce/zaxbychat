/**
 * Phase 6 port test — schema.ts.
 *
 * Covers the donor `schema_parser.py:19-130` extraction cases:
 *   - VIRTUAL table + IF NOT EXISTS + schema prefix + quoted identifiers.
 *   - Multiple CREATE TABLE blocks in a single file.
 *   - Empty / whitespace-only input returns [].
 *   - File-ext validation: .sql / .ddl accepted, others rejected.
 *   - File-not-found error.
 *   - File-size guard.
 */
import { promises as fs } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseSchemaFile,
  parseSchemaText,
  SCHEMA_MAX_FILE_SIZE_BYTES,
} from '../schema';

describe('parseSchemaText', () => {
  it('extracts a simple CREATE TABLE block', () => {
    const sql = 'CREATE TABLE users (id INT PRIMARY KEY, name TEXT);';
    const chunks = parseSchemaText(sql);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.tableName).toBe('users');
    expect(chunks[0].metadata.objectType).toBe('table');
    expect(chunks[0].metadata.sourceFile).toBeNull();
    expect(chunks[0].text).toContain('CREATE TABLE users');
    expect(chunks[0].text).toContain('id INT PRIMARY KEY');
  });

  it('handles VIRTUAL + IF NOT EXISTS + schema prefix + quoted identifiers', () => {
    const sql =
      'CREATE VIRTUAL TABLE IF NOT EXISTS `app`.`events` (id INT, ts DATETIME);';
    const chunks = parseSchemaText(sql);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.tableName).toBe('events');
  });

  it('extracts multiple CREATE TABLE blocks', () => {
    const sql = `
      CREATE TABLE a (id INT);
      CREATE TABLE b (id INT, val TEXT);
    `;
    const chunks = parseSchemaText(sql);
    expect(chunks.map((c) => c.metadata.tableName)).toEqual(['a', 'b']);
  });

  it('returns [] for empty or whitespace-only input', () => {
    expect(parseSchemaText('')).toEqual([]);
    expect(parseSchemaText('   \n\t  ')).toEqual([]);
  });

  it('is case-insensitive (donor `re.IGNORECASE`)', () => {
    const sql = 'create table lower_case (id int);';
    const chunks = parseSchemaText(sql);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.tableName).toBe('lower_case');
  });

  it('handles multi-line column blocks (donor `re.DOTALL`)', () => {
    const sql = 'CREATE TABLE t (\n  id INT,\n  name TEXT\n);';
    const chunks = parseSchemaText(sql);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain('id INT');
    expect(chunks[0].text).toContain('name TEXT');
  });
});

describe('parseSchemaFile', () => {
  let tmp: string;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'phase6-schema-'));
  });

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('parses a .sql file', async () => {
    const path = join(tmp, 'x.sql');
    await writeFile(path, 'CREATE TABLE t (id INT);', 'utf-8');
    const chunks = await parseSchemaFile(path);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].metadata.sourceFile).toBe(path);
  });

  it('accepts .ddl extension', async () => {
    const path = join(tmp, 'y.ddl');
    await writeFile(path, 'CREATE TABLE y (id INT);', 'utf-8');
    const chunks = await parseSchemaFile(path);
    expect(chunks).toHaveLength(1);
  });

  it('rejects unsupported extensions', async () => {
    const path = join(tmp, 'x.txt');
    await writeFile(path, 'CREATE TABLE t (id INT);', 'utf-8');
    await expect(parseSchemaFile(path)).rejects.toThrow(/Invalid file extension/);
  });

  it('surfaces file-not-found', async () => {
    await expect(parseSchemaFile(join(tmp, 'missing.sql'))).rejects.toThrow(/File not found/);
  });

  it('enforces the 50MB cap', async () => {
    const path = join(tmp, 'big.sql');
    await writeFile(path, 'CREATE TABLE t (id INT);', 'utf-8');
    const origStat = fs.stat;
    jest.spyOn(fs, 'stat').mockImplementation(async (...args) => {
      const stat = await origStat(...(args as Parameters<typeof origStat>));
      Object.defineProperty(stat, 'size', { value: SCHEMA_MAX_FILE_SIZE_BYTES + 1 });
      return stat;
    });
    await expect(parseSchemaFile(path)).rejects.toThrow(/exceeds maximum allowed size/);
  });
});
