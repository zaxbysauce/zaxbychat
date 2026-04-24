/**
 * Phase 6 — SQL/DDL schema parser.
 *
 * Port of ragappv3 `backend/app/services/schema_parser.py` (donor SHA
 * abce92498cb1ed30083bce88e8fa3652b0a4ce0b, lines 1-130). Extracts
 * `CREATE TABLE` blocks from `.sql` / `.ddl` files. Python `pathlib.Path`
 * is replaced with `node:fs/promises`; regex translates directly.
 */

import { promises as fs } from 'node:fs';
import { extname } from 'node:path';

export type SchemaChunk = {
  text: string;
  metadata: {
    tableName: string;
    objectType: 'table';
    sourceFile: string | null;
  };
};

export const SCHEMA_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
export const SCHEMA_VALID_EXTENSIONS = new Set<string>(['.sql', '.ddl']);

/**
 * Donor regex — schema_parser.py:25-30. Flags: case-insensitive +
 * dot-matches-newline. JS equivalent: `gis`. Global flag added to power
 * `matchAll` iteration (donor uses `finditer`).
 */
const CREATE_TABLE_PATTERN =
  /CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[`"']?\w+[`"']?\.)?[`"']?(\w+)[`"']?\s*\(([\s\S]*?)\);/gis;

export async function parseSchemaFile(filePath: string): Promise<SchemaChunk[]> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    throw err;
  }

  const ext = extname(filePath).toLowerCase();
  if (!SCHEMA_VALID_EXTENSIONS.has(ext)) {
    throw new Error(
      `Invalid file extension '${ext}'. Expected one of: ${Array.from(SCHEMA_VALID_EXTENSIONS).join(', ')}`,
    );
  }

  if (stat.size > SCHEMA_MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `File size ${stat.size} bytes exceeds maximum allowed size of ${SCHEMA_MAX_FILE_SIZE_BYTES} bytes (50MB)`,
    );
  }

  const content = await fs.readFile(filePath, { encoding: 'utf-8' });
  return extractTables(content, filePath);
}

export function parseSchemaText(sqlText: string): SchemaChunk[] {
  if (!sqlText || !sqlText.trim()) {
    return [];
  }
  return extractTables(sqlText, null);
}

function extractTables(content: string, sourceFile: string | null): SchemaChunk[] {
  const chunks: SchemaChunk[] = [];
  const matches = content.matchAll(CREATE_TABLE_PATTERN);
  for (const match of matches) {
    const tableName = match[1];
    const columnBlock = match[2].trim();
    chunks.push({
      text: `CREATE TABLE ${tableName} (\n${columnBlock}\n);`,
      metadata: {
        tableName,
        objectType: 'table',
        sourceFile,
      },
    });
  }
  return chunks;
}
