# SemanticLens messy demo dataset

## Upload destinations

- Import `pipedrive-messy-import.csv` into Pipedrive.
- Upload only the contents of `drive-upload/UPLOAD_THIS_FOLDER` to Google Drive.
- Never upload `GROUND_TRUTH_DO_NOT_UPLOAD`; it is reserved for automated evaluation.

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
