import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const out = path.join(root, "demo-data");
const driveRoot = path.join(out, "drive-upload", "UPLOAD_THIS_FOLDER");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(driveRoot, { recursive: true });

const rows = [
  ["ABC Private Limited", "abc jun wala", "Open", 18500, "INR", "G-M", "AA", "27AB-JUN", "f2 old drv", "06/26", "T1", "n", "mail", "grm ne 18/7 ko kar diya; ack mail me 89123"],
  ["ABC Pvt Ltd", "ABC IT old copy", "Open", 0, "INR", "grm", "", "27AB-JUN", "same as first; don't use", "Jun26", "old", "y", "copy", "duplicate from old list; main row abc jun wala"],
  ["Cedar Works", "cedar rtn", "Won", 12000, "INR", "KS", "AA", "CDR-06", "final", "Jun26", "T1", "n", "call", "status galat; abhi file nahi hua; client OTP pending"],
  ["Nova Retail", "nova return work", "Open", 15000, "INR", "karan", "Q7", "NV-29871", "wrong-folder", "05-2026", "T2", "n", "arn", "arn 29871 aa gaya; client calls it IT work"],
  ["Mehta Traders", "MHT old matter", "Lost", 9000, "INR", "G.S", "Z9", "MHT-0426", "dead folder", "Apr 26", "old", "y", "paper", "lost means old client only; itr filed; ack old folder me"],
  ["Orion Foods", "orion tax", "Lost", 11000, "INR", "RN", "CX", "ORI-0626", "stop-mail", "06-26", "T2", "n", "cancel", "client said stop; no filing; do not count"],
  ["Aster Labs", "aster annual", "Open", 13000, "INR", "gari", "PD", "AST-0726", "bank stm", "Jul/26", "T1", "n", "wa", "bank statement pending; not ready"],
  ["BluePeak Services", "BP comp", "Open", 14500, "INR", "riya", "AA", "BP-0526", "mail doc", "May-26", "T2", "n", "mail", "done 26 may; receipt in mail dump"],
  ["Sunbird Hospitality", "sun tax", "Won", 16000, "INR", "GM", "AA", "SUN-0626", "maybe final", "0626", "T1", "n", "team", "team says filed but arn not found anywhere"],
  ["Alpha Manufacturing", "alpha monthly", "Open", 7000, "INR", "grm", "AA", "GST-AL-0626", "misc 3b", "Jun-26", "G1", "n", "gst", "3B done; ack in misc; official status not changed"],
  ["Beta Logistics", "beta compliance", "Won", 7200, "INR", "KS", "AA", "GST-BE-0626", "final gst", "06/26", "G1", "n", "otp", "won auto set; otp pending; file not submitted"],
  ["Gamma Ventures", "gamma gst", "Open", 6800, "INR", "Ria", "Q7", "GST-GA-0526", "55GA", "May26", "G2", "n", "arn", "ARN 55GA confirmed in weird folder"],
  ["Delta Hardware", "delta gst june", "Lost", 6500, "INR", "GM", "CX", "GST-DH-0626", "stop", "June", "G2", "n", "call", "cancelled by client; no return filed"],
  ["Delta Consulting", "q1 challan stuff", "Open", 8500, "INR", "G-M", "AA", "TDS-DL-Q1", "26q", "Q1FY26", "D1", "n", "portal", "26Q upload ok; token 7711"],
  ["Echo Media", "echo q1", "Won", 8400, "INR", "KS", "AA", "TDS-EC-Q1", "final q1", "Apr-Jun", "D1", "n", "draft", "DRAFT only do not submit; salary correction pending"],
  ["Zeta Bio", "zeta CFA", "Open", 22000, "INR", "CS1", "PD", "CFA-Z-26", "dir kyc", "FY26", "C1", "n", "mca", "dir kyc missing; cfa stays open"],
  ["Eta Mobility", "eta cfa thing", "Open", 24000, "INR", "CS1", "AA", "CFA-E-26", "srn mca", "FY26", "C1", "n", "mca", "SRN received in MCA; board still not moved"],
  ["Horizon Textiles", "agreement redline", "Open", 30000, "INR", "G-M", "Q7", "CTR-HZ-01", "legal/temp", "Jul26", "L1", "n", "sign", "client accepted; signed copy drive legal/temp"],
  ["Internal Operations", "office stock jul", "Open", 0, "INR", "ADM", "Q7", "INV-JUL", "stock latest", "Jul26", "OPS", "n", "sheet", "latest sheet maybe ops drive; laptop 11 with Amit"],
  ["Kite Exports", "kite itr 25-26", "Open", 12500, "INR", "garma", "AA", "KTE-AY26", "scan", "AY25-26", "T1", "n", "scan", "signed json uploaded; filing receipt says submitted by G Sharma"],
];

const headers = [
  "Organization Name", "Deal Title", "Deal Status", "Deal Value", "Currency",
  "Legacy", "Bucket 2", "Ref", "Misc", "Cycle", "Desk", "Old Flag", "Trace", "Note Content"
];

const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
fs.writeFileSync(path.join(out, "pipedrive-messy-import.csv"), csv, "utf8");
const opaqueFieldNames = ["Legacy", "Bucket 2", "Ref", "Misc", "Cycle", "Desk", "Old Flag", "Trace"];
const backfill = rows.map((row) => {
  const record = Object.fromEntries(headers.map((header, index) => [header, row[index]]));
  return {
    dealTitle: record["Deal Title"],
    fields: Object.fromEntries(opaqueFieldNames.map((name) => [name, record[name]]))
  };
});
fs.writeFileSync(path.join(out, "pipedrive-api-backfill.json"), JSON.stringify(backfill, null, 2), "utf8");

const docs = [
  {
    dir: "misc-2026/abc-old",
    name: "final2_27AB.pdf",
    title: "INCOME TAX RETURN ACKNOWLEDGEMENT",
    body: ["Legal name: ABC Private Limited", "PAN fragment: 27AB", "Assessment period: 2025-26", "Submitted: 18 July 2026", "Prepared by: Garima Sharma", "Acknowledgement: AA27072689123", "Status: Return successfully submitted"]
  },
  {
    dir: "random copies",
    name: "ABC_final_COPY.pdf",
    title: "Downloaded Copy",
    body: ["Reference: 27AB-JUN", "Copy of acknowledgement AA27072689123", "This is a duplicate download, not a second filing."]
  },
  {
    dir: "clients/cedar/final",
    name: "ITR_FINAL.pdf",
    title: "DRAFT COMPUTATION — NOT SUBMITTED",
    body: ["Client: Cedar Works", "Period: June 2026", "Prepared by: Karan", "OTP pending from client", "No acknowledgement number has been generated", "DO NOT TREAT AS FILED"]
  },
  {
    dir: "wrong client folder/old-misc",
    name: "ack_29871.pdf",
    title: "RETURN SUBMISSION RECEIPT",
    body: ["Taxpayer: Nova Retail", "Reference: NV-29871", "Submitted: 26 May 2026", "Handled by: Karan Shah", "Status: Successfully filed"]
  },
  {
    dir: "dead leads/mht",
    name: "old_scan_do_not_delete.pdf",
    title: "ITR ACKNOWLEDGEMENT",
    body: ["Taxpayer: Mehta Traders", "Reference: MHT-0426", "Filed: 29 April 2026", "Prepared by: G. Sharma", "Acknowledgement: MHT442901", "CRM Lost means archived client; filing was completed"]
  },
  {
    dir: "mail dump/orion",
    name: "stop_work.pdf",
    title: "CLIENT INSTRUCTION",
    body: ["Client: Orion Foods", "Reference: ORI-0626", "Please stop the income-tax filing", "No return should be submitted", "Instruction received 20 June 2026"]
  },
  {
    dir: "clients/aster/incomplete",
    name: "checklist_latest.pdf",
    title: "DOCUMENT CHECKLIST",
    body: ["Client: Aster Labs", "Work type: Income Tax Return", "Reference: AST-0726", "Bank statement: MISSING", "Submission status: NOT READY", "Handler written in note: gari"]
  },
  {
    dir: "mail dump/receipts",
    name: "bp_no_name_0526.pdf",
    title: "INCOME TAX E-FILING RECEIPT",
    body: ["Taxpayer: BluePeak Services", "Return type: Income Tax Return", "Reference: BP-0526", "Submitted: 26 May 2026", "Prepared by: Riya N.", "Status: Successful"]
  },
  {
    dir: "clients/sunbird",
    name: "FINAL_RETURN.pdf",
    title: "WORKING PAPER — UNVERIFIED",
    body: ["Client: Sunbird Hospitality", "Reference: SUN-0626", "Computation prepared", "Submission receipt: not available", "The team believes this was filed, but no ARN or acknowledgement was located"]
  },
  {
    dir: "misc-2026/gst",
    name: "3b_misc_alpha.pdf",
    title: "GSTR-3B ACKNOWLEDGEMENT",
    body: ["Taxpayer: Alpha Manufacturing", "Reference: GST-AL-0626", "Tax period: June 2026", "Filed by: Garima Sharma", "ARN: GSTAL662211", "Status: Filed"]
  },
  {
    dir: "clients/beta/final",
    name: "GST_FINAL.pdf",
    title: "GSTR-3B DRAFT",
    body: ["Client: Beta Logistics", "Reference: GST-BE-0626", "OTP pending", "Not submitted", "Filename is not proof of filing"]
  },
  {
    dir: "wrong client folder/gamma",
    name: "55GA.pdf",
    title: "GST RETURN RECEIPT",
    body: ["Taxpayer: Gamma Ventures", "Reference: GST-GA-0526", "Period: May 2026", "ARN: 55GA", "Prepared by: Riya", "Status: Successfully filed"]
  },
  {
    dir: "mail dump/delta-hw",
    name: "cancelled.pdf",
    title: "CANCELLATION NOTE",
    body: ["Client: Delta Hardware", "Reference: GST-DH-0626", "Client cancelled the engagement", "No GST return was filed"]
  },
  {
    dir: "tds/q1/misc",
    name: "token_7711.pdf",
    title: "FORM 26Q UPLOAD CONFIRMATION",
    body: ["Deductor: Delta Consulting", "Reference: TDS-DL-Q1", "Quarter: Q1 FY 2026", "Token: 7711", "Uploaded by G. Sharma", "Status: Accepted"]
  },
  {
    dir: "tds/q1/final",
    name: "Echo_Q1_FINAL.pdf",
    title: "FORM 26Q — DRAFT ONLY",
    body: ["Deductor: Echo Media", "Reference: TDS-EC-Q1", "Salary correction pending", "Do not submit", "No token number"]
  },
  {
    dir: "corp/zeta",
    name: "CFA_checklist.pdf",
    title: "CORPORATE FILING APPLICATION CHECKLIST",
    body: ["Entity: Zeta Bio", "Reference: CFA-Z-26", "Director KYC missing", "Application remains open", "No SRN issued"]
  },
  {
    dir: "corp/eta/old-board",
    name: "mca_srn_eta.pdf",
    title: "MCA SERVICE REQUEST RECEIPT",
    body: ["Entity: Eta Mobility", "Reference: CFA-E-26", "SRN: MCA-E-77821", "Submitted successfully", "CRM board was not updated"]
  },
  {
    dir: "legal/temp",
    name: "hz_signed_copy.pdf",
    title: "SIGNED AGREEMENT",
    body: ["Party: Horizon Textiles", "Reference: CTR-HZ-01", "Accepted and signed by both parties", "Reviewed by G-M", "Execution date: 11 July 2026"]
  },
  {
    dir: "ops/stock/archive",
    name: "Stock_Master_FINAL.pdf",
    title: "STOCK REGISTER — OLD COPY",
    body: ["Reference: INV-JUL", "Generated: 2 July 2026", "Superseded by the current stock register", "Laptop-11 location was Reception"]
  },
  {
    dir: "ops/weird-new-location",
    name: "stk_jul_v7_reallylatest.pdf",
    title: "CURRENT STOCK REGISTER",
    body: ["Reference: INV-JUL", "Updated: 14 July 2026", "Laptop-11 issued to Amit", "Router-4 is in server room", "This is the latest inventory file"]
  },
  {
    dir: "kite/scan uploads",
    name: "KTE_receipt_scan.pdf",
    title: "INCOME TAX RETURN RECEIPT",
    body: ["Taxpayer: Kite Exports", "Reference: KTE-AY26", "Assessment year: 2025-26", "Submitted by: G Sharma", "Acknowledgement: KTE260071", "Status: Successfully filed"]
  }
];

const pdfText = (value) => String(value)
  .normalize("NFKD")
  .replace(/[^\x20-\x7E]/g, "-")
  .replaceAll("\\", "\\\\")
  .replaceAll("(", "\\(")
  .replaceAll(")", "\\)");

const createSimplePdf = (title, lines) => {
  const contentLines = [
    "BT",
    "/F1 16 Tf",
    "50 760 Td",
    `(${pdfText(title)}) Tj`,
    "0 -30 Td",
    "/F1 11 Tf",
    ...lines.flatMap((line) => [`(${pdfText(line)}) Tj`, "0 -22 Td"]),
    "0 -18 Td",
    "/F1 9 Tf",
    "(Synthetic assessment evidence document) Tj",
    "ET"
  ];
  const stream = contentLines.join("\n") + "\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
};

for (const doc of docs) {
  const pdfDir = path.join(driveRoot, doc.dir);
  fs.mkdirSync(pdfDir, { recursive: true });
  fs.writeFileSync(path.join(pdfDir, doc.name), createSimplePdf(doc.title, doc.body));
}

const staleRows = [headers, ...rows.slice(0, 7)].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
const archiveDir = path.join(driveRoot, "archive exports");
fs.mkdirSync(archiveDir, { recursive: true });
fs.writeFileSync(path.join(archiveDir, "crm_dump_old_DO_NOT_COUNT_SEPARATELY.csv"), staleRows, "utf8");

const groundTruth = {
  warning: "TEST-ONLY. Do not upload this folder to Pipedrive or Google Drive.",
  canonicalItems: [
    { id: "ITR-ABC-0626", type: "income_tax_filing", client: "ABC Private Limited", owner: "Garima Sharma", state: "completed", duplicateDealTitles: ["abc jun wala", "ABC IT old copy"], proof: "AA27072689123" },
    { id: "ITR-CDR-0626", type: "income_tax_filing", client: "Cedar Works", owner: "Karan Shah", state: "open", reason: "OTP pending" },
    { id: "ITR-NV-0526", type: "income_tax_filing", client: "Nova Retail", owner: "Karan Shah", state: "completed", proof: "29871" },
    { id: "ITR-MHT-0426", type: "income_tax_filing", client: "Mehta Traders", owner: "Garima Sharma", state: "completed", proof: "MHT442901" },
    { id: "ITR-ORI-0626", type: "income_tax_filing", client: "Orion Foods", owner: "Riya Nair", state: "cancelled" },
    { id: "ITR-AST-0726", type: "income_tax_filing", client: "Aster Labs", owner: "Garima Sharma", state: "open", reason: "Bank statement pending" },
    { id: "ITR-BP-0526", type: "income_tax_filing", client: "BluePeak Services", owner: "Riya Nair", state: "completed" },
    { id: "ITR-SUN-0626", type: "income_tax_filing", client: "Sunbird Hospitality", owner: "Garima Sharma", state: "unknown", reason: "Claimed filed but no receipt" },
    { id: "ITR-KTE-AY26", type: "income_tax_filing", client: "Kite Exports", owner: "Garima Sharma", state: "completed", proof: "KTE260071" },
    { id: "GST-AL-0626", type: "gst_filing", client: "Alpha Manufacturing", owner: "Garima Sharma", state: "completed" },
    { id: "GST-BE-0626", type: "gst_filing", client: "Beta Logistics", owner: "Karan Shah", state: "open", reason: "OTP pending" },
    { id: "GST-GA-0526", type: "gst_filing", client: "Gamma Ventures", owner: "Riya Nair", state: "completed" },
    { id: "GST-DH-0626", type: "gst_filing", client: "Delta Hardware", owner: "Garima Sharma", state: "cancelled" },
    { id: "TDS-DL-Q1", type: "tds_return", client: "Delta Consulting", owner: "Garima Sharma", state: "completed" },
    { id: "TDS-EC-Q1", type: "tds_return", client: "Echo Media", owner: "Karan Shah", state: "open", reason: "Draft and salary correction pending" },
    { id: "CFA-Z-26", type: "corporate_filing_application", client: "Zeta Bio", owner: "Corporate Team", state: "open" },
    { id: "CFA-E-26", type: "corporate_filing_application", client: "Eta Mobility", owner: "Corporate Team", state: "completed" },
    { id: "CTR-HZ-01", type: "contract", client: "Horizon Textiles", owner: "Garima Sharma", state: "completed" },
    { id: "INV-JUL", type: "inventory_register", client: "Internal Operations", state: "current", location: "ops/weird-new-location/stk_jul_v7_reallylatest.pdf" }
  ],
  expectedEvaluations: [
    { question: "How many income tax filings have we completed?", expected: 5, note: "ABC duplicate counts once; Sunbird is unknown; cancelled is excluded." },
    { question: "How many income tax matters are open?", expected: 2, note: "Cedar and Aster; Sunbird remains unknown, not open." },
    { question: "How many verified filings did Garima complete?", expected: 4, note: "ABC ITR, Mehta ITR, Alpha GST and Delta TDS. Contract is not a filing; Kite uses G Sharma and is also a filing, making 5 if all filing types and all periods are intended. This question should trigger scope clarification." },
    { question: "Which CRM-completed records are missing independent proof?", expectedItems: ["Sunbird Hospitality"] },
    { question: "Where is the latest inventory file?", expected: "ops/weird-new-location/stk_jul_v7_reallylatest.pdf" },
    { question: "How many CFA matters are open?", expected: 1 }
  ]
};

const truthDir = path.join(out, "GROUND_TRUTH_DO_NOT_UPLOAD");
fs.mkdirSync(truthDir, { recursive: true });
fs.writeFileSync(path.join(truthDir, "ground-truth.json"), JSON.stringify(groundTruth, null, 2), "utf8");

const readme = `# SemanticLens messy demo dataset

## Upload destinations

- Import \`pipedrive-messy-import.csv\` into Pipedrive.
- Upload only the contents of \`drive-upload/UPLOAD_THIS_FOLDER\` to Google Drive.
- Never upload \`GROUND_TRUTH_DO_NOT_UPLOAD\`; it is reserved for automated evaluation.

## Why the data is messy

- Official deal states are deliberately stale or misleading.
- The Pipedrive account owner acts like a shared login.
- Opaque custom fields contain inconsistent codes and aliases.
- Notes contain Hindi-English shorthand, negations, and important truth.
- Drive filenames and folders can be misleading.
- The Drive archive contains a stale CRM export that must not be double-counted.
- Completion requires stronger evidence such as acknowledgement, ARN, SRN, or accepted token.

## Pipedrive field mapping

Map the first five columns to Organization/Deal built-in fields. Create text custom deal fields for Legacy, Bucket 2, Ref, Misc, Cycle, Desk, Old Flag, and Trace. Map Note Content to a note linked to the deal when the import UI offers that option; otherwise import the rows first and add notes in a second import.
`;
fs.writeFileSync(path.join(out, "README.md"), readme, "utf8");

console.log(JSON.stringify({ out, rows: rows.length, pdfSources: docs.length }, null, 2));
