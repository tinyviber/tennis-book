<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Repository guidance

## App and book content

- This is a Next.js App Router book reader. Read `README.md` for architecture and deployment; reader content lives in `data/books/` and is committed with the application.
- The repository contains `tennis-improvement` (47 sections), `tennis-system-training` (93 sections, including 72 exercise entries), `tennis-footwork` (6 sections, adapted from an 8-page article), and `tennis-pressure-training` (12 sections, combining the two volumes). Source scans and import review materials under `data/imports/` remain local and ignored by Git.
- Keep the two source-book editions intact and separate. The beginner-oriented cross-book proposal is in `docs/beginner-edition-plan.md`; it is an editorial plan, not permission to rewrite either source edition.

## Training-book import and editorial checks

- See `docs/import-training-book.md` before rebuilding or correcting the second book. Its importer, `scripts/import-training-book.py`, regenerates the second book's chapters and images from OCR and review files under `data/imports/tennis-system-training/`; it does not modify the first book. Back up or finish manual edits before rerunning it.
- See `docs/import-tennis-footwork.md` before rebuilding or correcting the third reader volume. It is a short article with extractable PDF text, not a full-length book; its screenshots and source transcript are kept under `data/imports/tennis-footwork/`.
- See `docs/import-pressure-training.md` before rebuilding or correcting the combined pressure-training volume. Its two 124-page source PDFs are scanned images; the score tables on lower-volume PDF pages 70–76 are shown as scan crops because OCR loses or misaligns many cells.
- The source PDF has 211 pages: pages 1–210 are scanned pages and page 211 is a generated bookmark index. Printed page numbers are PDF page minus 4. Do not treat the bookmark page as book content.
- Compare OCR against the scan before changing text, especially names, directions, numbers, units, anatomy, and exercise steps. Preserve source wording and mark unresolved source defects in editorial notes instead of guessing. The body text has not been fully proofread.
- Source illustrations and their printed-page metadata are part of the reading experience. Preserve the original when using an AI-cleaned image, and keep its prompt and processing record in the import metadata. Do not use generated images to infer anatomical details or prove a movement technique.
- The current local content baseline passes `npm run check-content` with 4 books, 158 sections, and 869 image groups. Counts may change when content changes.

## Validation and deployment

- After content or reader changes, run the relevant checks: `npm run check`, `npm test`, `npm run check-content`, and `npm run build`. `check-content` validates local data; run it separately from the build.
- For visual changes, check both a desktop and a narrow mobile viewport, and exercise chapter navigation, search, and image zoom when affected.
- `data/books/` is tracked by Git. The Vercel deployment reads this committed content and is read-only; edits must be committed and pushed to trigger a deployment. It does not use Vercel Blob or require content-related environment variables. Review the Vercel section of `README.md` before changing deployment behavior.
