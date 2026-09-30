# InvoiceDesk

A ReceiptBank-style app for capturing supplier invoices and receipts. Upload PDFs or photos, and the app extracts supplier, customer, invoice header, tax and line-item data into a relational database, then lets you review and approve it next to the original document.

- **Backend:** Node.js 18+, Express, Knex (SQLite by default, SQL Server supported)
- **Extraction tools (choose per upload):** Claude, Google Gemini, OpenAI GPT, AWS Textract, Google Cloud Document AI, Azure AI Document Intelligence, or built-in basic text matching
- **Frontend:** React 18 + Vite
- **Version 2:** sign-in with DocuSoft logins, approval by another user with notifications, a full audit trail, and extraction in the C# web service with keys stored encrypted in `DS_AgreementTable` (see [Version 2](#version-2-approvals-notifications-audit-server-side-extraction))

## Quick start

```bash
# 1. Install everything
npm run install:all

# 2. Configure the API
cp backend/.env.example backend/.env
#    then set up at least one extraction tool in backend/.env (see "Extraction tools" below)

# 3. Run API (port 4000) and web app (port 5173) together
npm run dev
```

Open http://localhost:5173 and drop `samples/sample-invoice.pdf` onto the upload area.

For production, run `npm run build` then `npm start`. The API serves the built React app on port 4000.

## Extraction tools

Every tool implements the same `ExtractionProvider` class, so the rest of the app doesn't care which one read a document. Pick a tool in the upload area ("Extract with"), or re-run any document with a different tool from its review screen. The Extraction tools page shows which tools are set up and exactly which settings are missing.

| Tool | Type | Reads | Line items | Settings in `backend/.env` |
|---|---|---|---|---|
| Claude | Vision LLM | PDF, JPG, PNG, WEBP, GIF | Yes | `ANTHROPIC_API_KEY` |
| Google Gemini | Vision LLM | PDF, JPG, PNG, WEBP | Yes | `GEMINI_API_KEY` |
| OpenAI GPT | Vision LLM | PDF, JPG, PNG, WEBP, GIF | Yes | `OPENAI_API_KEY` |
| AWS Textract | Invoice OCR | PDF, JPG, PNG | Yes (no units) | `AWS_REGION` + AWS credentials; `TEXTRACT_S3_BUCKET` for multi-page PDFs |
| Google Document AI | Invoice OCR | PDF, JPG, PNG, WEBP, GIF | Yes | `GOOGLE_DOCAI_PROJECT_ID`, `GOOGLE_DOCAI_LOCATION`, `GOOGLE_DOCAI_PROCESSOR_ID` + service account |
| Azure Document Intelligence | Invoice OCR | PDF, JPG, PNG | Yes | `AZURE_DOCINTEL_ENDPOINT`, `AZURE_DOCINTEL_KEY` |
| Basic text matching | Regex | Text PDFs only | No | none |

**Automatic** uses `EXTRACTION_PROVIDER` if that tool is set up and can read the file type; otherwise the first ready tool in this order: Claude, Azure, Textract, Document AI, Gemini, OpenAI, Basic. If you choose a specific tool that can't read a file (for example Textract with a WEBP), that document fails with a clear message and you can re-run it with another tool.

The AWS and Google Cloud SDKs are optional dependencies loaded only when those tools run. Gemini, OpenAI and Azure use plain REST calls.

### Setting up each tool

- **AWS Textract:** create an IAM user or role with `textract:AnalyzeExpense` (plus `textract:StartExpenseAnalysis`, `textract:GetExpenseAnalysis`, and `s3:PutObject`/`s3:DeleteObject` on the bucket for multi-page PDFs). Leave the key variables empty to use your AWS profile or an instance role.
- **Google Document AI:** in the Cloud console enable Document AI, create an **Invoice Parser** processor (or Expense Parser for receipts), note its ID and region (`eu` or `us`), and point `GOOGLE_APPLICATION_CREDENTIALS` at a service-account key with the Document AI API User role.
- **Azure Document Intelligence:** create a Document Intelligence resource and copy its endpoint and key. Use `AZURE_DOCINTEL_MODEL=prebuilt-receipt` for till receipts.
- **Gemini / OpenAI / Claude:** an API key is all you need; the model can be changed with `*_MODEL`.

### Adding another tool

1. Create `backend/src/extractors/MyToolExtractor.js`:

```js
import { ExtractionProvider } from './ExtractionProvider.js';
import { emptyResult, MIME } from './shared/helpers.js';

export class MyToolExtractor extends ExtractionProvider {
  constructor() {
    super({
      id: 'mytool',                       // stored in the database, max 20 chars
      name: 'My Tool',
      vendor: 'Example Ltd',
      kind: 'ocr',                        // llm | ocr | basic
      description: 'What it does, in one or two sentences.',
      supportedMimeTypes: [MIME.pdf, MIME.png],
      requiredEnv: ['MYTOOL_API_KEY'],
      capabilities: { lineItems: true, scans: true },
    });
  }

  async extract({ filePath, mimeType, originalName }) {
    const response = /* call the service */ {};
    const out = emptyResult();            // the common shape
    out.supplier.name = response.vendor;
    out.invoice.total_amount = response.total;
    out.line_items = response.lines.map((l) => ({ description: l.text, quantity: l.qty, unit_price: l.price, net_amount: l.amount }));
    out.confidence = 0.9;
    return out;
  }
}
```

2. Register it in `ExtractorRegistry.js` with `.register(new MyToolExtractor())` and, optionally, add its id to `PRIORITY`.

It then appears in the upload picker, on the Extraction tools page and in `GET /api/extractors`. Values can be raw strings like `"£1,234.50"` or `"12/08/2026"`; `normalize.js` cleans them and runs the checks.

## How extraction works

1. Files are uploaded to `backend/uploads` and a row is created in `invoices` with status `queued` and the chosen tool in `requested_provider`.
2. An in-process queue (2 in parallel by default) asks the registry for the tool, and the tool returns data in the common shape. LLM tools get a strict JSON schema (`extractors/shared/extractionSchema.js`); OCR tools have mappers that translate their own response formats. The tool that actually ran is stored in `extraction_method`.
3. `normalize.js` cleans the output (currency symbols, thousand separators, European decimals, UK day-first dates) and runs checks:
   - required fields present (supplier, number, date, total)
   - each line: quantity × unit price = net
   - sum of lines = subtotal
   - subtotal − discount + tax + shipping = total
4. The supplier and customer are matched to existing records by VAT number, then by name, so repeat suppliers aren't duplicated. A document with the same supplier and invoice number as an existing one is flagged as a possible duplicate.
5. Status becomes `extracted` if everything checks out and confidence is at least `REVIEW_CONFIDENCE_THRESHOLD`, otherwise `needs_review`. Failures are stored with the error message and can be re-run.

**With no tool set up** the app still runs using basic text matching on text-based PDFs. It picks up header fields and totals but not line items, and cannot read scans or photos.

## Statuses

| Status | Meaning |
|---|---|
| queued / processing | Waiting for or being read by the extractor |
| extracted | Read with high confidence and all checks passed |
| needs_review | A check failed, confidence was low, or it may be a duplicate. Also where a document goes when an approver sends it back |
| pending_approval | Sent to another user to approve ("Awaiting approval") |
| approved | Approved, by the assigned approver or (if the agreement allows it) directly by the reviewer |
| rejected | The approver rejected it, with a reason. Fix it and send it for approval again |
| split | A merged PDF that held several documents. Each part is now its own document; this one is kept, hidden from the inbox, and links to them |
| failed | Extraction errored; see the message on the review screen |

## Data layer

All database access goes through one module (`backend/src/data/`), chosen with `DATA_BACKEND` in `backend/.env`:

| `DATA_BACKEND` | What it does | Use it for |
|---|---|---|
| `asmx` (set in `.env.example`) | Calls the InvoiceDesk operations in DocuSoft's `PracticeServices.asmx`, which run the `proc_invoicedesk_*` stored procedures in the client database | Normal use, sharing data with DocuSoft WebForms apps |
| `knex` | Talks to SQLite, or SQL Server, directly through Knex | Offline development |

Both provide the same functions, so the routes, the extraction queue and the React app behave the same either way. With `asmx`, the header shows a red banner if the web service can't be reached or rejects the login. The API keeps running and recovers as soon as the service is back.

### Connecting to PracticeServices

The InvoiceDesk operations are deployed in `https://accountancy.docusoftweb.com/PracticeServices.asmx`. In `backend/.env`:

```env
DATA_BACKEND=asmx
ASMX_URL=https://accountancy.docusoftweb.com/PracticeServices.asmx
ASMX_AGRNO=...        # selects the client database
ASMX_EMAIL=...
ASMX_PASSWORD=...
```

Restart the API. The console prints `Connected to https://accountancy.docusoftweb.com/PracticeServices.asmx`, or the reason it couldn't connect: a rejected login, the service being unreachable, or a `Json_` method that isn't deployed or has different parameters.

To work offline, run the mock web service in a second terminal with `npm run mock-asmx --prefix backend`. Then set `ASMX_URL=http://localhost:4100/PracticeServices.asmx` with the demo login shown in `.env.example`. It reads the method signatures from `asmx/App_Code/InvoiceDeskService.cs` and rejects any call whose parameters don't match, so it also checks that the Node client and the C# agree. It stores data in its own SQLite file, which makes it a stand-in for the stored procedures, not a test of them. To test the procedures themselves, run `database/invoicedesk.test.sql`.

**Uploaded files** stay on the Node server in `UPLOAD_DIR`; only the data goes through the web services. If WebForms pages also need to open the original documents, point `UPLOAD_DIR` at a shared folder or UNC path that both can reach, or move storage to blob storage.

## Version 2: approvals, notifications, audit, server-side extraction

These need `DATA_BACKEND=asmx`. With `knex` the app stays single-user and extracts with the keys in `backend/.env`.

**Sign-in.** Users sign in with their DocuSoft agreement number, email and password, checked by `Json_InvoiceDeskLogin` (your `GetAccessToken`). The Node API keeps the login in memory in a session identified by a random HttpOnly, SameSite cookie, and makes every web-service call with it, so each user reaches their own agreement's database and actions are recorded against the right person. The password never goes back to the browser. Sessions end on sign-out, after 8 hours without activity, or when the API restarts. Five failed sign-ins for an email lock it for 10 minutes.

**Approval by another user.** On the review page, "Send for approval" sends the document to another person with an optional note. Nobody can send a document to themselves. The approver sees a banner and a bell notification when they open the app, the document appears under **Approvals**, and they can:
- **Approve** (saving any edits first),
- **Send back for review**, with a comment, which returns it to `needs_review`, or
- **Reject**, with a comment, which sets it to `rejected`.

The person who sent it is notified either way, and the review page shows the whole history. The agreement setting **Require an approver**, on the Extraction tools page and on by default, removes the reviewer's own Approve button, which is enforced in the stored procedure as well. Turn it off to allow direct approval again.

**Audit trail.** Every operation on an invoice or receipt is recorded:
- uploaded
- extraction re-run, extracted (with the tool, confidence and the values read) and extraction failed
- edited (each changed field, old and new value)
- sent for approval, reassigned, approved, approved without approver, rejected and sent back (with comments)
- deleted (with a snapshot of the document)
- exported to CSV
- extraction settings changed (tool and field names only, never key values)

Entries are written by the stored procedures inside the same transaction as the operation, so anything that calls them is audited, including WebForms pages and scripts. `dbo.invoicedesk_audit_log` is append-only: a trigger refuses UPDATE and DELETE. Entries keep the user's name and the document's label, so they still read correctly after the document is deleted. The review page has an **Activity** section, and **Audit log** lists everything with filters (dates, action, search), paging and a CSV download.

**Extraction in the web service.** Keys are entered on the Extraction tools page and saved by `Json_SaveExtractionSettings`, which encrypts them into `DS_AgreementTable.InvoiceDesk_ExtractionSettings`. Reads only ever return masked values (`****abcd`), and leaving a key box empty keeps the stored key. For each document the Node API sends the file to `Json_ExtractInvoiceDocument`. The C# service calls Claude, OpenAI, Gemini, Azure Document Intelligence, AWS Textract or Google Document AI with the stored keys and returns the result, which Node then checks and saves as before. No provider key is held by Node or reaches the browser.

**Merged files.** A PDF with several invoices or receipts in it is split into one document per invoice, and each part is extracted on its own. It works like this:

- **Finding the parts.** With `DATA_BACKEND=asmx`, the web service uses the agreement's Claude, Gemini, OpenAI or Azure tool (`Json_DetectInvoiceDocuments`); these handle scans too. Otherwise, or if only Textract or Google Document AI is set up, the API reads each page's text. A page starts a new document when it shows a different invoice number or "Page 1 of". A page with no number, such as a cover letter, a continuation or a remittance slip, stays with the document it belongs to.
- **Splitting.** The API cuts the PDF with `pdf-lib`, so the pages keep their original quality. It saves one file per part and records them with `Json_SplitInvoice`.
- **Naming.** Each part is named like `scans-august (pages 2-3).pdf` and remembers its pages and the file it came from.
- **The original.** It is kept with status `split`, is hidden from the inbox, and shows links to its parts.

The upload area has a "Split PDFs that hold several invoices" option, on by default. For anything detection gets wrong, the review page of a PDF offers **Split it into separate documents**. That shows the suggested page ranges (`1, 2-3, 4`) and lets you change them before splitting. Both automatic and manual splits are in the audit trail. Documents that are approved or waiting for approval can't be split.

Deployment steps for the SQL and C# are in [asmx/README-ASMX.md](asmx/README-ASMX.md#version-2).

## Database

Tables: `suppliers`, `customers`, `invoices`, `invoice_taxes` (one row per VAT/tax rate), `line_items`. The schema is created automatically on startup (`backend/src/db/schema.js`), or run `npm run migrate --prefix backend`.

### SQL Server with stored procedures and ASMX web services

`database/invoicedesk.tables-and-procedures.sql` creates the tables and stored procedures (in `dbo`, all prefixed `invoicedesk_`) for every operation; `invoicedesk.all-ds-databases.sql` does the same in every DS0% database on the server, and `asmx/` contains matching ASMX web services. Setup, the method reference and the JSON formats are in `asmx/README-ASMX.md`.

### Letting the Node API connect to SQL Server directly

This is separate from the ASMX setup above: Knex creates its own `dbo` tables.

```env
DB_CLIENT=mssql
MSSQL_SERVER=localhost
MSSQL_PORT=1433
MSSQL_USER=sa
MSSQL_PASSWORD=yourPassword
MSSQL_DATABASE=InvoiceDesk
MSSQL_ENCRYPT=false
MSSQL_TRUST_CERT=true
```

Create the empty database first (`CREATE DATABASE InvoiceDesk`); the tables are created on startup. 

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/extractors` | Extraction tools, whether each is set up, and which one "auto" uses |
| POST | `/api/invoices/upload` | Multipart upload, field name `files` (up to 25), optional field `provider` (`auto` or a tool id) |
| GET | `/api/invoices` | List. Query: `search`, `status`, `supplierId`, `customerId` |
| GET | `/api/invoices/:id` | Invoice with supplier, customer, taxes and line items |
| GET | `/api/invoices/:id/file` | Original file |
| PUT | `/api/invoices/:id` | Save reviewed data: `{ supplier, customer, invoice, taxes, line_items, approve }` |
| POST | `/api/invoices/:id/reprocess` | Run extraction again; optional body `{ "provider": "aws-textract" }` |
| DELETE | `/api/invoices/:id` | Delete document, data and file |
| GET | `/api/invoices/export/csv` | One row per line item with header and supplier fields |
| GET | `/api/suppliers`, `/api/suppliers/:id` | Suppliers with document counts and totals |
| PUT | `/api/suppliers/:id` | Edit supplier details |
| GET/PUT | `/api/customers`, `/api/customers/:id` | Same for customers |
| GET | `/api/stats`, `/api/health` | Dashboard figures and configuration status |

## Project layout

```
backend/
  tools/mock-asmx.js          Mock InvoiceDeskService.asmx for local testing (npm run mock-asmx)
  src/
    server.js                 Express app, static hosting of the built frontend
    config.js                 Environment settings
    db/                       Knex connection and schema
    routes/                   invoices.js, parties.js (suppliers/customers)
    extractors/
      ExtractionProvider.js   Base class every tool extends
      ExtractorRegistry.js    Registers tools, resolves "auto", validates choices
      ClaudeExtractor.js, GeminiExtractor.js, OpenAIExtractor.js
      AwsTextractExtractor.js, GoogleDocumentAIExtractor.js, AzureDocumentIntelligenceExtractor.js
      BasicTextExtractor.js
      shared/                 JSON schema, prompt, helpers
    data/
      index.js                Picks the data layer from DATA_BACKEND
      knexRepository.js       Direct SQLite / SQL Server access
      asmxRepository.js       Same functions, via the ASMX web services
      asmxClient.js           ASMX call, response parsing and error handling
    services/
      normalize.js            Cleaning and arithmetic validation
      repository.js           Re-exports the chosen data layer
      processor.js, queue.js  Background extraction pipeline
frontend/
  src/
    pages/Inbox.jsx           Upload + document list with live status
    pages/InvoiceReview.jsx   Side-by-side document and editable fields
    pages/PartyList.jsx       Suppliers / customers
    pages/PartyDetail.jsx     Supplier / customer detail and documents
    pages/ExtractionTools.jsx Which tools are set up and what each needs
    components/ToolSelect.jsx Extraction tool picker
database/invoicedesk.tables-and-procedures.sql   SQL Server tables + stored procedures (dbo, one database)
database/invoicedesk.all-ds-databases.sql        Same, for every DS0% database on the server
database/invoicedesk.test.sql                    Smoke test for the procedures
database/build-all-databases.js                  Regenerates the all-databases file
asmx/                                ASMX web services (see asmx/README-ASMX.md)
samples/sample-invoice.pdf
```

## Production notes

- The queue is in-process. For multiple API instances or high volume, move it to BullMQ/Redis or Azure Service Bus; `processInvoice(id)` is already self-contained.
- Files are stored on local disk. Swap `multer.diskStorage` and the `/file` route for Azure Blob or S3 in production.
- There is no authentication. Put it behind your existing login, and add a `company_id`/tenant column if multiple clients share one database.
- Very long multi-page PDFs (100+ lines) may need splitting; the extractor reports a clear error if output is cut off.
- Cost is one call per document for every tool. OCR services charge per page; LLMs charge per token, and smaller models (`*_MODEL`) are cheaper for simple receipts.
- Accuracy varies by document type. Upload the same batch with two tools and compare them on the review screen before choosing a default.
