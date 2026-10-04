<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Repository guidance

## App and book content

- This is a Next.js App Router book reader. Read `README.md` for architecture and deployment; runtime book content is stored separately from application code.
- Book data lives in the Git-ignored `data/` directory. This working copy currently has `tennis-improvement` (47 sections) and `tennis-system-training` (93 sections, including 72 exercise entries). A fresh clone will not contain the books or source scans; check whether the relevant local data exists before assuming it can be rebuilt.
- Keep the two source-book editions intact and separate. The beginner-oriented cross-book proposal is in `docs/beginner-edition-plan.md`; it is an editorial plan, not permission to rewrite either source edition.

## Training-book import and editorial checks

- See `docs/import-training-book.md` before rebuilding or correcting the second book. Its importer, `scripts/import-training-book.py`, regenerates the second book's chapters and images from OCR and review files under `data/imports/tennis-system-training/`; it does not modify the first book. Back up or finish manual edits before rerunning it.
- The source PDF has 211 pages: pages 1–210 are scanned pages and page 211 is a generated bookmark index. Printed page numbers are PDF page minus 4. Do not treat the bookmark page as book content.
- Compare OCR against the scan before changing text, especially names, directions, numbers, units, anatomy, and exercise steps. Preserve source wording and mark unresolved source defects in editorial notes instead of guessing. The body text has not been fully proofread.
- Source illustrations and their printed-page metadata are part of the reading experience. Preserve the original when using an AI-cleaned image, and keep its prompt and processing record in the import metadata. Do not use generated images to infer anatomical details or prove a movement technique.
- The current local content baseline passes `npm run check-content` with 2 books, 140 sections, and 766 image groups. Counts may change when content changes.

## Validation and deployment

- After content or reader changes, run the relevant checks: `npm run check`, `npm test`, `npm run check-content`, and `npm run build`. `check-content` validates local data; run it separately from the build.
- For visual changes, check both a desktop and a narrow mobile viewport, and exercise chapter navigation, search, and image zoom when affected.
- A Git push does not include `data/` or publish book content. Vercel uses private Blob storage; when deployment requires book content, migrate from a working copy that has the data and a configured `BLOB_READ_WRITE_TOKEN` with `npm run migrate-vercel-blob`. Review `docs/import-training-book.md` and the Vercel section of `README.md` first.
