# SemanticLens — Adaptive Business Truth Engine

SemanticLens translates plain-English questions into verified answers over tenant-specific, messy business data. The working demo uses live Pipedrive, Google Drive, and Notion sources, MongoDB Atlas, and Gemini.

Gemini understands questions and extracts evidence into a controlled schema. It never supplies final counts. The backend filters, deduplicates, validates, and calculates answers from stored record evidence.

## What makes this a semantic layer

- Discovers what a client's custom fields mean from their actual values and cross-record correlations.
- Learns aliases such as `Garima`, `Grima`, `G. Sharma`, `G-M`, and `GM`.
- Treats official CRM owner/status fields as claims, not guaranteed truth.
- Links CRM rows to independent PDF evidence by client, topic, period, reference, and learned terminology.
- Deduplicates the same business item across sources before counting.
- Gives `UNKNOWN`, `CONFLICT`, or asks for clarification when evidence cannot support an answer.
- Returns a verified zero only after relevant healthy sources were checked and no unresolved matching evidence exists.
- Stores raw source payloads for auditability while answering from normalized business truths.
- Shows the answer first and keeps calculation/evidence inside an optional reviewer panel.

## Current live demo

The supplied messy dataset contains:

- 21 live Pipedrive deals, including odd custom columns, shared official ownership, typos, aliases, stale statuses, duplicates, and notes carrying hidden meaning.
- 22 Google Drive document records: 21 searchable PDFs plus a stale CRM export deliberately placed in the evidence folder.
- An import-ready Notion work tracker with deliberately misleading board statuses, abbreviated owners, duplicate work, and evidence hidden in free text (`demo-data/notion-messy-import.csv`).
- Conflicting, incomplete, draft, acknowledgement, receipt, inventory, GST, income-tax, and CFA evidence.
- A hidden ground-truth folder that must not be uploaded or indexed by the application.

The local document folder is retained only as an offline development fallback. Once Google Drive has synced, the compiler automatically excludes that mirror so identical files cannot pretend to be independent evidence.

## Run in VS Code

Requirements: Node.js 20 or newer, MongoDB Atlas, a Gemini API key, a Pipedrive API token, and a read-only Google Drive service account for the live document demo.

```powershell
cd outputs/semanticlens
npm.cmd run install:all
Copy-Item server/.env.example server/.env
npm.cmd run dev
```

Open `http://localhost:5173`. API health is at `http://localhost:4000/api/health`.

Keep all credentials only in `server/.env`; never commit or paste them into source code.

## Live ingestion and compilation

The frontend **Sources** screen can sync each source and rebuild the tenant semantic map. The API workflow is also available directly:

```text
POST /api/connectors/pipedrive/sync
POST /api/connectors/documents/sync
POST /api/connectors/google-drive/sync
POST /api/connectors/notion/sync
POST /api/semantic/compile
POST /api/questions/answer
```

Compilation performs batched evidence extraction, field-role learning, alias clustering, cross-source entity resolution, lifecycle validation, conflict detection, and business-truth fusion. Query-time work is smaller: Gemini creates a structured plan, while deterministic backend code executes it against compiled truths.

## Add live Google Drive evidence

1. Enable the Google Drive API in the Google Cloud project.
2. Create a service account and download its JSON key to `server/secrets/google-service-account.json`. The entire `server/secrets/` folder is Git-ignored.
3. Upload only `demo-data/drive-upload/UPLOAD_THIS_FOLDER` to a Google Drive root folder. Never upload the hidden ground-truth folder.
4. Share that Drive root folder as **Viewer** with the service-account email from the JSON key.
5. Copy the folder ID from its URL and add it to `server/.env`:

```env
GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY_FILE=./secrets/google-service-account.json
GOOGLE_DRIVE_ROOT_FOLDER_ID=your_shared_folder_id
```

6. Restart the API, open **Sources**, and click **Sync & rebuild** on **Google Drive Evidence**.

The connector recursively traverses nested folders, paginates large listings, retries throttled requests, caches unchanged content, downloads supported files with bounded concurrency, exports Google Workspace files, preserves Drive links and metadata, and flags scans for OCR. A partial traversal never deletes the last known-good evidence snapshot.

## Add the live Notion work tracker

1. Import `demo-data/notion-messy-import.csv` into Notion as a full-page database.
2. Create an internal Notion connection with read-content capability and copy its installation token.
3. Open the imported database, choose **••• → Connections / Add connections**, and share it with that connection.
4. Under **Manage data sources**, open the data source menu and choose **Copy data source ID**.
5. Add only these values to `server/.env`, then restart the API:

```env
NOTION_VERSION=2026-03-11
NOTION_TOKEN=your_internal_connection_token
NOTION_DATA_SOURCE_ID=your_data_source_id
```

If Notion hides **Copy data source ID**, copy the database ID from the full-page URL and use `NOTION_DATABASE_ID` instead. The connector retrieves the database and resolves its first data source automatically.

6. Open **Sources** and click **Sync & rebuild** on **Notion Work Tracker**.

The connector uses pagination, preserves the raw Notion page payload in Atlas, normalizes arbitrary property types, retries short rate limits, and caps tracker claims below independent documentary proof.

## What to show in the walkthrough

- In Pipedrive list view, expose `Legacy`, `Bucket 2`, `Ref`, `Misc`, `Cycle`, `Desk`, `Old Flag`, and `Trace` alongside official status. This reveals aliases and contradictions such as a **Won** deal whose note says OTP is pending.
- Show the evidence folder names such as `wrong client folder`, `dead leads`, `mail dump`, `FINAL`, and `reallylatest`.
- Show the Notion board where `Done`, `Backlog`, and `Archived` labels contradict free-text evidence.
- Ask one question, show the clean answer, then expand reviewer evidence to demonstrate that clean output was produced from messy source records.

## Demo questions

These are examples, not hardcoded routes:

1. `How many income tax filings have we completed?`
2. `How many income tax matters are open?`
3. `Where is the latest inventory file?`
4. `How many CFA matters are open?`
5. `Is Cedar Works income tax return filed?`
6. `How many GST filings did Grima complete?`

The same query planner accepts other topics, clients, people, operations, and wording found in the compiled tenant glossary. Unsupported or ambiguous requests stop safely instead of producing a plausible-looking answer.

## Architecture

```text
Pipedrive API         Google Drive API           Notion API
      |                      |                       |
      +--------------- source adapters --------------+
                     |
           raw records in Atlas
                     |
       batched Gemini fact extraction
                     |
 field-role learning + alias resolution
                     |
 evidence fusion + conflict validation
                     |
       versioned tenant semantic map
          + canonical business truths
                     |
 natural-language query -> Gemini query plan
                     |
 deterministic filter / dedupe / calculation
                     |
 answer first + expandable reviewer evidence
```

## PDF and OCR behavior

Text-based PDFs are parsed directly; all 21 demo PDFs currently contain searchable text. OCR is needed only for scans or image-only PDFs. Such files are flagged with `ocrRequired` instead of being silently treated as empty evidence. A production adapter can send only those flagged files through OCR, reducing cost and latency.

## Verification

```powershell
npm.cmd run build
npm.cmd test
```

The current 14-test evaluation verifies completed/open income-tax counts, a latest inventory-file lookup, open CFA work, a CRM/document conflict for Cedar Works, a misspelled owner query for Garima, out-of-domain refusal, recursive Drive traversal, pagination, retries, and safe unconfigured behavior.

## Honest production boundary

No system can guarantee a correct answer for every imaginable question or for data that contains no usable signal. This prototype covers the assessment's core trust problem: it adapts to client-specific conventions, combines more than one platform type, explains every answer, avoids hallucinated numbers, and refuses unsupported conclusions. Production hardening would add OAuth credential vaulting, background queues, webhooks/incremental sync, OCR workers, tenant RBAC, observability, and connector-specific rate-limit scheduling.
