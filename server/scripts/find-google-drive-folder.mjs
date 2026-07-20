import 'dotenv/config';
import { google } from 'googleapis';

const name = process.argv[2] || 'UPLOAD_THIS_FOLDER';
const keyFile = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY_FILE || './secrets/google-service-account.json';
const auth = new google.auth.GoogleAuth({
  keyFile,
  scopes: ['https://www.googleapis.com/auth/drive.readonly']
});
const drive = google.drive({ version: 'v3', auth });
const escaped = name.replaceAll("'", "\\'");
const response = await drive.files.list({
  q: `name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  spaces: 'drive',
  pageSize: 20,
  fields: 'files(id,name,parents,webViewLink)'
});

console.log(JSON.stringify({
  matches: (response.data.files || []).map(({ id, name: folderName, parents, webViewLink }) => ({
    id,
    name: folderName,
    parents,
    webViewLink
  }))
}, null, 2));
