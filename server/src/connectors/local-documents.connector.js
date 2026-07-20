import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';

const allowedExtensions = new Set(['.pdf', '.txt', '.md', '.csv', '.json', '.html']);

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.isFile() && allowedExtensions.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }
  return files;
}

async function extractPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return { text: result.text?.trim() || '', pages: result.total || null, method: 'pdf-text' };
  } finally {
    await parser.destroy();
  }
}

export class LocalDocumentsConnector {
  get root() {
    return path.resolve(process.env.LOCAL_DOCUMENT_ROOT || path.resolve(process.cwd(), '../demo-data/drive-upload/UPLOAD_THIS_FOLDER'));
  }

  async testConnection() {
    try {
      const stat = await fs.stat(this.root);
      if (!stat.isDirectory()) throw new Error('Configured path is not a directory');
      const files = await walk(this.root);
      return { configured: true, status: 'healthy', root: this.root, supportedFiles: files.length };
    } catch (error) {
      return { configured: true, status: 'error', message: error.message };
    }
  }

  async fetchDocuments() {
    const files = await walk(this.root);
    const documents = [];
    for (const fullPath of files) {
      const buffer = await fs.readFile(fullPath);
      const stat = await fs.stat(fullPath);
      const extension = path.extname(fullPath).toLowerCase();
      const relativePath = path.relative(this.root, fullPath).replaceAll('\\', '/');
      let extracted;
      if (extension === '.pdf') extracted = await extractPdf(buffer);
      else extracted = { text: buffer.toString('utf8').trim(), pages: null, method: 'plain-text' };
      documents.push({
        id: crypto.createHash('sha256').update(relativePath).digest('hex').slice(0, 24),
        name: path.basename(fullPath),
        relativePath,
        extension,
        mimeType: extension === '.pdf' ? 'application/pdf' : 'text/plain',
        modifiedAt: stat.mtime.toISOString(),
        size: stat.size,
        checksum: crypto.createHash('sha256').update(buffer).digest('hex'),
        content: extracted.text,
        extractionMethod: extracted.method,
        pages: extracted.pages,
        ocrRequired: extension === '.pdf' && extracted.text.length < 20
      });
    }
    return documents;
  }
}

export const localDocumentsConnector = new LocalDocumentsConnector();
