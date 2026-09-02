# Documents Lab Testing

## Goal
Use the `/documents-lab` page to quickly evaluate DOCX/PDF import quality before production rollout.

## What The Lab Currently Measures
- DOCX:
  - HTML conversion size
  - Lexical phase-A mapping summary (`mappedFeatures`, `downgradedFeatures`)
  - Plain text extraction preview
  - Fallback usage when lexical state cannot be built
- PDF:
  - Extractable text length
  - Basic metadata (`pageCount`, `title`, `producer`)
  - Warning when text extraction is empty (common for scanned PDFs without OCR)

## How To Run
1. Start app: `npm run dev`
2. Sign in and choose an active org
3. Open `/documents-lab`
4. Upload up to 10 files at a time (`.docx`, `.pdf`)
5. Review warnings and downgraded features

## Corpus Setup
Create a shared corpus directory in-repo:

- `testing/documents-corpus/easy/`
- `testing/documents-corpus/medium/`
- `testing/documents-corpus/hard/`
- `testing/documents-corpus/scanned-pdf/`

Suggested file mix:
- Headings + numbered lists
- Multi-level nested lists
- Tables with merged cells
- Documents with links and highlighted text
- Documents with images and charts
- PDFs exported from Office and scanned-image PDFs

## Team Workflow
1. Add a batch of files to the corpus folders.
2. Run them through `/documents-lab`.
3. Save notable failures in a simple tracker with:
   - file name
   - detected type
   - downgraded features (for DOCX)
   - warning text
   - short human note of what broke

## Next Planned Upgrade
Add round-trip scoring (input -> import -> export -> structural diff score) so each file gets a numeric fidelity grade.
