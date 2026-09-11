"""Extract paper content from IEEE LaTeX into a structured dict (accuracy-preserving)."""
import re, json, sys

src = open("main_FINAL.tex").read()

# ---------- citation keys in bibitem order ----------
keys = re.findall(r"\\bibitem\{([^}]+)\}", src)
CITE = {k: i + 1 for i, k in enumerate(keys)}

# ---------- bibliography entries ----------
bib_block = src.split(r"\begin{thebibliography}")[1].split(r"\end{thebibliography}")[0]
raw_items = re.split(r"\\bibitem\{[^}]+\}", bib_block)[1:]


def detex(t, keep_marks=True):
    t = t.replace("\\%", "\x01")          # protect escaped percent
    t = re.sub(r"%.*", "", t)               # strip real LaTeX comments
    t = t.replace("\x01", "%")
    t = re.sub(r"\\label\{[^}]*\}", "", t)
    t = t.replace("\\&", "&").replace("\\_", "_")
    t = t.replace("\\#", "#").replace("\\$", "$")
    # citations
    def cite_sub(m):
        ks = [k.strip() for k in m.group(1).split(",")]
        return ", ".join("[" + str(CITE.get(k, "?")) + "]" for k in ks)
    t = re.sub(r"\\cite\{([^}]+)\}", cite_sub, t)
    # cross references -> readable
    t = re.sub(r"(Fig\.|Figure)~\\ref\{fig:architecture\}", "Fig. 1", t)
    t = re.sub(r"(Fig\.|Figure)~\\ref\{fig:dataflow\}", "Fig. 2", t)
    t = re.sub(r"(Fig\.|Figure)~\\ref\{fig:datamodel\}", "Fig. 3", t)
    t = re.sub(r"(Fig\.|Figure)~\\ref\{fig:screens\}", "Fig. 4", t)
    t = re.sub(r"Table~\\ref\{tab:dataset\}", "Table I", t)
    t = re.sub(r"Table~\\ref\{tab:efficiency\}", "Table II", t)
    t = re.sub(r"Algorithm~\\ref\{alg:eta\}", "Algorithm 1", t)
    t = re.sub(r"Section~\\ref\{sec:intro\}", "Section I", t)
    t = re.sub(r"Section~\\ref\{sec:related\}", "Section II", t)
    t = re.sub(r"Section~\\ref\{sec:architecture\}", "Section III", t)
    t = re.sub(r"Section~\\ref\{sec:implementation\}", "Section IV", t)
    t = re.sub(r"Section~\\ref\{sec:evaluation\}", "Section V", t)
    t = re.sub(r"Section~\\ref\{sec:conclusion\}", "Section VI", t)
    t = re.sub(r"Sections~\\ref\{sec:impl-arbitration\}--\\ref\{sec:impl-eta\}",
               "Sections IV-A--IV-C", t)
    t = re.sub(r"Section~\\ref\{sec:impl-arbitration\}", "Section IV-A", t)
    t = re.sub(r"Section~\\ref\{sec:impl-filter\}", "Section IV-B", t)
    t = re.sub(r"Section~\\ref\{sec:impl-eta\}", "Section IV-C", t)
    t = re.sub(r"Section~\\ref\{sec:impl-device\}", "Section IV-F", t)
    t = re.sub(r"Section~\\ref\{sec:eval-discussion\}", "Section V-F", t)
    t = re.sub(r"Section~\\ref\{sec:[^}]+\}", "this section", t)
    # formatting markers (kept as sentinels for docx runs)
    if keep_marks:
        t = re.sub(r"\\emph\{([^{}]*)\}", r"«i»\1«/i»", t)
        t = re.sub(r"\\textit\{([^{}]*)\}", r"«i»\1«/i»", t)
        t = re.sub(r"\\textbf\{([^{}]*)\}", r"«b»\1«/b»", t)
        t = re.sub(r"\\textsc\{([^{}]*)\}", lambda m: m.group(1).upper(), t)
    else:
        t = re.sub(r"\\(emph|textit|textbf|textsc)\{([^{}]*)\}", r"\2", t)
    t = re.sub(r"\\url\{([^}]*)\}", r"\1", t)
    t = re.sub(r"\\texttt\{([^}]*)\}", r"\1", t)
    # math + spacing
    t = t.replace("$\\geq 5$", "\u2265 5").replace("$\\geq$", "\u2265")
    t = re.sub(r"\$\\approx\$|\\approx", "\u2248", t)
    t = re.sub(r"\$\\times\$|\\times", "\u00d7", t)
    t = re.sub(r"\$\{?\\sim\}?\$|\{\\sim\}|\\sim", "\u2248", t)
    t = re.sub(r"\$([^$]*)\$", r"\1", t)
    t = t.replace("\\,", "\u2009").replace("\\ ", " ")
    t = t.replace("~", " ")
    t = t.replace("{,}", ",")
    t = t.replace("---", "\u2014").replace("--", "\u2013")
    t = t.replace("``", "\u201c").replace("''", "\u201d")
    t = re.sub(r"\\[a-zA-Z]+\*?", "", t)
    t = t.replace("{", "").replace("}", "")
    t = re.sub(r"[ \t\n]+", " ", t)
    return t.strip()


# ---------- abstract / keywords ----------
abstract = detex(src.split(r"\begin{abstract}")[1].split(r"\end{abstract}")[0])
keywords = detex(src.split(r"\begin{IEEEkeywords}")[1].split(r"\end{IEEEkeywords}")[0])

# ---------- body: strip float environments ----------
body = src.split(r"\end{IEEEkeywords}")[1].split(r"\section*{Acknowledgment}")[0]
for env in ["figure\\*", "figure", "table", "algorithm"]:
    body = re.sub(r"\\begin\{" + env + r"\}.*?\\end\{" + env + r"\}", "", body,
                  flags=re.S)
body = re.sub(r"(?<!\\)%[^\n]*", "", body)

ack = detex(src.split(r"\section*{Acknowledgment}")[1]
            .split(r"\begin{thebibliography}")[0])

# ---------- section tree ----------
tokens = re.split(r"(\\section\{[^}]*\}|\\subsection\{[^}]*\}|\\subsubsection\{[^}]*\})",
                  body)
doc = []
cur_sec = None
for tok in tokens:
    m = re.match(r"\\(section|subsection|subsubsection)\{([^}]*)\}", tok)
    if m:
        doc.append({"kind": m.group(1), "title": detex(m.group(2), keep_marks=False),
                    "paras": []})
    else:
        if not doc:
            continue
        tok = re.sub(r"\\begin\{(itemize|enumerate)\}", "\n\n", tok)
        tok = re.sub(r"\\end\{(itemize|enumerate)\}", "\n\n", tok)
        tok = tok.replace("\\item ", "\n\n\u2022ITEM\u2022 ")
        chunks = [c.strip() for c in re.split(r"\n\s*\n", tok) if c.strip()]
        for c in chunks:
            if re.match(r"^\\label", c) and len(c.split()) < 3:
                continue
            txt = detex(c)
            if len(txt) > 2:
                doc[-1]["paras"].append(txt)

bib = [detex(x, keep_marks=True) for x in raw_items]

out = {"abstract": abstract, "keywords": keywords, "sections": doc,
       "ack": ack, "bib": bib}
json.dump(out, open("content.json", "w"), ensure_ascii=False, indent=1)

print("sections:", len(doc), " bib:", len(bib))
for s in doc:
    print(f"  [{s['kind'][:3]}] {s['title'][:52]:<52} paras={len(s['paras'])}")
print("\nABSTRACT:", abstract[:160], "...")
print("\nBIB[1]:", bib[0][:90])
print("BIB[24]:", bib[23][:90])
