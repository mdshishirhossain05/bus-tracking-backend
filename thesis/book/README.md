# UniBus Live — B.Sc. Thesis Book (LaTeX source)

**Authors:** Md. Shishir Hossain (1005) · Md. Sajib Hasan (1008) · Md. Showkat Hossen (1009)
**Dept. of CSE, NPI University of Bangladesh — July 2026**

## How to compile

**Easiest (Overleaf):** upload this whole folder as a new project
(Menu → New Project → Upload Project → this zip). Set the compiler to
**pdfLaTeX** (Menu → Compiler). Press Recompile — done.

**On your own PC (TeX Live / MiKTeX):**
```
pdflatex main.tex
pdflatex main.tex      (run TWICE: 2nd pass fills TOC & cross-references)
```
The output is `main.pdf`.

## File map

| File | What it is |
|---|---|
| `main.tex` | Master file: packages, page layout, chapter order |
| `frontmatter.tex` | Cover, Declaration, Approval, Acknowledgement, Abstract |
| `abbreviations.tex` | List of Abbreviations |
| `ch1_introduction.tex` … `ch7_conclusion.tex` | The seven chapters |
| `references.tex` | The 24 references (numbered to match in-text [n]) |
| `appendices.tex` | Appendices A–E |
| `npiub_logo.png` | University crest (cover page) |
| `twofigs.pdf` | Vector figures: page 1 = architecture, page 2 = data flow |
| `screens.png` | 4-panel passenger composite (Chapter 5) |
| `shots/` | Passenger app screenshots (Appendix D) |
| `driver_shots/` | Driver app screenshots (Chapter 5) |
| `admin/` | Admin console screenshots (Chapter 5 + Appendix E) |

## How to add / replace an image (the right way)

1. **Put the file in the project folder** (or a subfolder like `shots/`).
   Use a simple name: **letters, numbers, `_` only — NO spaces, no Bangla
   characters in the filename**. `live_map.jpg` ✔ · `WhatsApp Image (2).jpeg` ✘
   (rename it first).

2. **Use JPG or PNG for screenshots/photos, PDF for diagrams.**
   PDF stays sharp at any print size (that's why the two architecture
   figures are `twofigs.pdf`). Screenshots are fine as JPG/PNG if they are
   at least ~700 px wide per column of print width.

3. **Insert with the standard block:**
   ```latex
   \begin{figure}[H]
   \centering
   \includegraphics[width=0.8\textwidth]{shots/live_map.jpg}
   \caption{One sentence saying what the reader is looking at.}
   \label{fig:livemap}
   \end{figure}
   ```
   - `[H]` = "put it exactly HERE" (needs `\usepackage{float}`, already loaded).
   - `width=0.8\textwidth` = 80% of the text width. Use `\textwidth` for
     full width, `0.49\textwidth` for two side-by-side, `0.235\textwidth`
     for four phone screenshots in a row (see Appendix D for the pattern).
   - **Never set both width and height** — one only, so the image is not
     distorted.

4. **Side-by-side images** (the pattern used throughout this book):
   ```latex
   \includegraphics[width=0.49\textwidth]{admin/routes.jpg}\hfill
   \includegraphics[width=0.49\textwidth]{admin/stops.jpg}
   ```
   `\hfill` pushes them apart evenly. All images in one row should have
   the same pixel aspect ratio or the row looks uneven.

5. **Refer to a figure in the text** with its label, never a hard number:
   `... as shown in Figure~\ref{fig:livemap}.` — numbering then updates
   itself if figures move. Compile **twice** after adding labels.

6. **To replace an existing image**, overwrite the file keeping the same
   filename — zero LaTeX edits needed, just recompile.

7. **Multi-page PDF figures:** pick a page with
   `\includegraphics[page=2, width=...]{twofigs.pdf}`.

## Common errors

| Error | Cause / fix |
|---|---|
| `File 'xyz.jpg' not found` | Wrong path or typo — path is relative to `main.tex` |
| `Unknown graphics extension` | Filename has spaces or double dots — rename it |
| Figure jumps to another page | Use `[H]`, or shrink the width a little |
| `??` where a number should be | Compile a second time |
| Image blurry in print | Source too small — use ≥150 dpi at printed size |
