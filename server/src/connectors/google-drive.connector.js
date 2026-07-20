import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { google } from 'googleapis';
import { PDFParse } from 'pdf-parse';

const DRIVE_FOLDER = 'application/vnd.google-apps.folder';
const DRIVE_SHORTCUT = 'application/vnd.google-apps.shortcut';
const GOOGLE_DOC = 'application/vnd.google-apps.document';
const GOOGLE_SHEET = 'application/vnd.google-apps.spreadsheet';
const GOOGLE_SLIDES = 'application/vnd.google-apps.presentation';
const GOOGLE_DRAWING = 'application/vnd.google-apps.drawing';
const READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DEFAULT_KEY_FILE = path.resolve(process.cwd(), 'secrets/google-service-account.json');

const blobTextMimeTypes = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/tab-separated-values',
  'text/html',
  'text/xml',
  'application/json',
  'application/xml'
]);

const blobTextExtensions = new Set(['.txt', '.md', '.csv', '.tsv', '.html', '.htm', '.json', '.xml']);

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.trunc(number))) : fallback;
}

function cleanPathSegment(value) {
  return String(value || 'unnamed')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replaceAll('/', '\uff0f')
    .trim() || 'unnamed';
}

function joinDrivePath(parent, name) {
  const segment = cleanPathSegment(name);
  return parent ? `${parent}/${segment}` : segment;
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  throw new TypeError('Google Drive returned an unsupported content payload');
}

function decodeText(buffer) {
  return new TextDecoder('utf-8', { fatal: false }).decode(buffer).replace(/^\uFEFF/, '').trim();
}

function errorStatus(error) {
  return Number(error?.response?.status ?? error?.status ?? error?.code) || null;
}

function retryReasons(error) {
  const errors = error?.response?.data?.error?.errors || error?.errors || [];
  return errors.map((entry) => String(entry?.reason || '')).filter(Boolean);
}

function isRetryable(error) {
  const status = errorStatus(error);
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  if (status === 403 && retryReasons(error).some((reason) => ['rateLimitExceeded', 'userRateLimitExceeded', 'backendError'].includes(reason))) return true;
  return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH'].includes(String(error?.code || ''));
}

function retryAfterMilliseconds(error) {
  const headers = error?.response?.headers;
  const value = headers?.get?.('retry-after') ?? headers?.['retry-after'];
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function safeErrorMessage(error) {
  const source = error?.response?.data?.error?.message || error?.message || 'request failed';
  return String(source)
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .slice(0, 300);
}

async function extractPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return { text: result.text?.trim() || '', pages: result.total || null, method: 'drive-pdf-text' };
  } finally {
    await parser.destroy();
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return output;
}

function exportTarget(file) {
  if (file.mimeType === GOOGLE_DOC) return { mimeType: 'text/plain', extension: '.txt', kind: 'text' };
  if (file.mimeType === GOOGLE_SHEET) return { mimeType: 'text/csv', extension: '.csv', kind: 'text' };
  if ([GOOGLE_SLIDES, GOOGLE_DRAWING].includes(file.mimeType)) return { mimeType: 'application/pdf', extension: '.pdf', kind: 'pdf' };
  return null;
}

function blobTarget(file) {
  const extension = path.extname(file.name || '').toLowerCase();
  if (file.mimeType === 'application/pdf' || extension === '.pdf') return { mimeType: 'application/pdf', extension: '.pdf', kind: 'pdf' };
  if (blobTextMimeTypes.has(file.mimeType) || blobTextExtensions.has(extension)) {
    return { mimeType: file.mimeType || 'text/plain', extension: extension || '.txt', kind: 'text' };
  }
  return null;
}

function previousFields(previous) {
  return previous?.fields || previous || null;
}

export class GoogleDriveConnector {
  constructor(options = {}) {
    this.options = options;
    this.driveClient = options.driveClient || null;
    this.sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = options.random || Math.random;
  }

  get rootFolderId() {
    return this.options.rootFolderId || process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '';
  }

  get keyFile() {
    return path.resolve(this.options.keyFile || process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS || DEFAULT_KEY_FILE);
  }

  get configured() {
    return Boolean(this.rootFolderId && (this.driveClient || this.keyFile));
  }

  get requestTimeoutMs() {
    return boundedInteger(this.options.requestTimeoutMs ?? process.env.GOOGLE_DRIVE_REQUEST_TIMEOUT_MS, 30000, 1000, 120000);
  }

  get maxAttempts() {
    return boundedInteger(this.options.maxAttempts ?? process.env.GOOGLE_DRIVE_MAX_ATTEMPTS, 5, 1, 8);
  }

  get maxFiles() {
    return boundedInteger(this.options.maxFiles ?? process.env.GOOGLE_DRIVE_MAX_FILES, 5000, 1, 100000);
  }

  get maxFileBytes() {
    return boundedInteger(this.options.maxFileBytes ?? process.env.GOOGLE_DRIVE_MAX_FILE_BYTES, 25 * 1024 * 1024, 1024, 100 * 1024 * 1024);
  }

  get concurrency() {
    return boundedInteger(this.options.concurrency ?? process.env.GOOGLE_DRIVE_DOWNLOAD_CONCURRENCY, 4, 1, 12);
  }

  async client() {
    if (this.driveClient) return this.driveClient;
    const auth = new google.auth.GoogleAuth({ keyFile: this.keyFile, scopes: [READONLY_SCOPE] });
    this.driveClient = google.drive({ version: 'v3', auth });
    return this.driveClient;
  }

  async retry(label, operation) {
    let lastError;
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!isRetryable(error) || attempt === this.maxAttempts - 1) break;
        const retryAfter = retryAfterMilliseconds(error);
        const exponential = Math.min(8000, 250 * (2 ** attempt));
        const delay = retryAfter ?? Math.round(exponential * (0.5 + this.random()));
        await this.sleep(delay);
      }
    }
    const status = errorStatus(lastError);
    throw Object.assign(new Error(`Google Drive ${label} failed${status ? ` (${status})` : ''}: ${safeErrorMessage(lastError)}`), {
      status: status === 401 || status === 403 ? status : 502,
      cause: lastError
    });
  }

  async ensureCredentialFile() {
    if (this.options.driveClient) return;
    const stat = await fs.stat(this.keyFile);
    if (!stat.isFile()) throw Object.assign(new Error('Google Drive credential path is not a file'), { status: 503 });
  }

  async rootMetadata() {
    const drive = await this.client();
    const response = await this.retry('root-folder check', () => drive.files.get({
      fileId: this.rootFolderId,
      supportsAllDrives: true,
      fields: 'id,name,mimeType,driveId,webViewLink'
    }, { timeout: this.requestTimeoutMs }));
    if (response.data?.mimeType !== DRIVE_FOLDER) {
      throw Object.assign(new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID must identify a folder'), { status: 422 });
    }
    return response.data;
  }

  async testConnection() {
    if (!this.rootFolderId) {
      return { configured: false, status: 'not_configured', message: 'Add GOOGLE_DRIVE_ROOT_FOLDER_ID to server/.env.' };
    }
    try {
      await this.ensureCredentialFile();
      const root = await this.rootMetadata();
      return {
        configured: true,
        status: 'healthy',
        rootName: root.name || 'Google Drive folder',
        rootType: root.driveId ? 'shared_drive' : 'shared_folder'
      };
    } catch (error) {
      return { configured: true, status: 'error', httpStatus: error.status || 502, message: safeErrorMessage(error) };
    }
  }

  async listChildren(folderId, pagePath) {
    const drive = await this.client();
    const files = [];
    let pageToken;
    for (let page = 0; page < 10000; page += 1) {
      const response = await this.retry('folder listing', () => drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        spaces: 'drive',
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        fields: 'nextPageToken,incompleteSearch,files(id,name,mimeType,parents,createdTime,modifiedTime,size,md5Checksum,sha256Checksum,version,webViewLink,description,driveId,capabilities/canDownload,shortcutDetails)'
      }, { timeout: this.requestTimeoutMs }));
      if (response.data?.incompleteSearch) {
        throw Object.assign(new Error(`Google Drive returned an incomplete listing below ${pagePath || 'the root folder'}`), { status: 502 });
      }
      files.push(...(response.data?.files || []));
      pageToken = response.data?.nextPageToken;
      if (!pageToken) break;
    }
    return files;
  }

  async discoverFiles() {
    const root = await this.rootMetadata();
    const queue = [{ id: root.id, relativePath: '' }];
    const visitedFolders = new Set();
    const files = [];
    let folders = 0;
    let shortcuts = 0;
    while (queue.length) {
      const folder = queue.shift();
      if (visitedFolders.has(folder.id)) continue;
      visitedFolders.add(folder.id);
      folders += 1;
      const children = await this.listChildren(folder.id, folder.relativePath);
      for (const file of children) {
        const relativePath = joinDrivePath(folder.relativePath, file.name);
        if (file.mimeType === DRIVE_FOLDER) queue.push({ id: file.id, relativePath });
        else if (file.mimeType === DRIVE_SHORTCUT) shortcuts += 1;
        else files.push({ ...file, relativePath });
        if (files.length + queue.length > this.maxFiles) {
          throw Object.assign(new Error(`Google Drive root exceeds the configured ${this.maxFiles}-item safety limit`), { status: 422 });
        }
      }
    }
    return { root, files, folders, shortcuts };
  }

  async download(file, target) {
    const drive = await this.client();
    const requestOptions = { responseType: 'arraybuffer', timeout: this.requestTimeoutMs };
    const response = file.mimeType.startsWith('application/vnd.google-apps.')
      ? await this.retry('file export', () => drive.files.export({ fileId: file.id, mimeType: target.mimeType }, requestOptions))
      : await this.retry('file download', () => drive.files.get({ fileId: file.id, alt: 'media', supportsAllDrives: true }, requestOptions));
    const buffer = toBuffer(response.data);
    if (buffer.byteLength > this.maxFileBytes) {
      throw Object.assign(new Error('Google Drive file content exceeded the configured download limit'), { status: 422, code: 'FILE_TOO_LARGE' });
    }
    return buffer;
  }

  metadataFingerprint(file) {
    if (file.md5Checksum) return `md5:${file.md5Checksum}`;
    if (file.sha256Checksum) return `sha256:${file.sha256Checksum}`;
    return `version:${file.version || ''}:${file.modifiedTime || ''}:${file.size || ''}`;
  }

  async extractFile(file, previous) {
    const target = exportTarget(file) || blobTarget(file);
    if (!target) return { skipped: { id: file.id, reason: 'unsupported_type', mimeType: file.mimeType } };
    if (file.capabilities?.canDownload === false) return { skipped: { id: file.id, reason: 'download_restricted', mimeType: file.mimeType } };
    const declaredSize = Number(file.size);
    if (Number.isFinite(declaredSize) && declaredSize > this.maxFileBytes) {
      return { skipped: { id: file.id, reason: 'too_large', mimeType: file.mimeType } };
    }

    const fingerprint = this.metadataFingerprint(file);
    const cached = previousFields(previous);
    const common = {
      id: file.id,
      name: file.name,
      relativePath: file.relativePath,
      extension: target.extension,
      mimeType: file.mimeType,
      exportedMimeType: file.mimeType.startsWith('application/vnd.google-apps.') ? target.mimeType : null,
      createdAt: file.createdTime || null,
      modifiedAt: file.modifiedTime || null,
      size: Number.isFinite(declaredSize) ? declaredSize : null,
      driveVersion: file.version || null,
      md5Checksum: file.md5Checksum || null,
      metadataFingerprint: fingerprint,
      webViewLink: file.webViewLink || null,
      description: file.description || null
    };
    if (cached?.metadataFingerprint === fingerprint && typeof cached.content === 'string') {
      return {
        document: {
          ...common,
          checksum: cached.checksum || file.md5Checksum || null,
          content: cached.content,
          extractionMethod: cached.extractionMethod,
          pages: cached.pages ?? null,
          ocrRequired: Boolean(cached.ocrRequired),
          cached: true
        }
      };
    }

    const buffer = await this.download(file, target);
    const extracted = target.kind === 'pdf'
      ? await extractPdf(buffer)
      : { text: decodeText(buffer), pages: null, method: file.mimeType.startsWith('application/vnd.google-apps.') ? 'drive-export-text' : 'drive-plain-text' };
    return {
      document: {
        ...common,
        size: common.size ?? buffer.byteLength,
        checksum: crypto.createHash('sha256').update(buffer).digest('hex'),
        content: extracted.text,
        extractionMethod: extracted.method,
        pages: extracted.pages,
        ocrRequired: target.kind === 'pdf' && extracted.text.length < 20,
        cached: false
      }
    };
  }

  async fetchSnapshot({ previousById = new Map() } = {}) {
    if (!this.rootFolderId) throw Object.assign(new Error('Google Drive connector is not configured'), { status: 503 });
    await this.ensureCredentialFile();
    const discovered = await this.discoverFiles();
    const settled = await mapWithConcurrency(discovered.files, this.concurrency, async (file) => {
      try {
        return await this.extractFile(file, previousById.get(file.id));
      } catch (error) {
        if (error?.code === 'FILE_TOO_LARGE') return { skipped: { id: file.id, reason: 'too_large', mimeType: file.mimeType } };
        return { failure: { id: file.id, status: error.status || 502, message: safeErrorMessage(error) } };
      }
    });
    const failures = settled.filter((item) => item.failure).map((item) => item.failure);
    if (failures.length) {
      throw Object.assign(new Error(`Google Drive sync was incomplete: ${failures.length} supported file${failures.length === 1 ? '' : 's'} could not be extracted`), {
        status: 502,
        code: 'DRIVE_SYNC_INCOMPLETE',
        failures: failures.map(({ id, status }) => ({ id, status }))
      });
    }
    const documents = settled.filter((item) => item.document).map((item) => item.document);
    const skipped = settled.filter((item) => item.skipped).map((item) => item.skipped);
    const ocrRequired = documents.filter((document) => document.ocrRequired).length;
    return {
      syncedAt: new Date().toISOString(),
      root: { id: discovered.root.id, name: discovered.root.name, webViewLink: discovered.root.webViewLink || null },
      documents,
      skipped,
      complete: true,
      coverageComplete: skipped.length === 0 && discovered.shortcuts === 0 && ocrRequired === 0,
      counts: {
        discoveredFiles: discovered.files.length,
        folders: discovered.folders,
        shortcutsSkipped: discovered.shortcuts,
        documents: documents.length,
        cached: documents.filter((document) => document.cached).length,
        pdfs: documents.filter((document) => document.extension === '.pdf').length,
        exported: documents.filter((document) => document.exportedMimeType).length,
        ocrRequired,
        skipped: skipped.length + discovered.shortcuts
      }
    };
  }

  async fetchDocuments(options) {
    return (await this.fetchSnapshot(options)).documents;
  }
}

export const googleDriveConnector = new GoogleDriveConnector();
