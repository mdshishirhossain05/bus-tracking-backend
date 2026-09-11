"""Build the IEEE-style .docx for UniBus Live from content.json (text == LaTeX source)."""
import json, re, sys
from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

C = json.load(open("content.json"))

# ---------- tunables (page-fit) ----------
BODY   = float(sys.argv[1]) if len(sys.argv) > 1 else 9.5
SMALL  = BODY - 1.5      # captions / refs / tables
LEAD   = float(sys.argv[2]) if len(sys.argv) > 2 else 0.99
FIGW   = float(sys.argv[3]) if len(sys.argv) > 3 else 3.30
SERIF  = "Times New Roman"

doc = Document()

# ---------- page geometry (US Letter, IEEE conference) ----------
sec = doc.sections[0]
sec.page_width, sec.page_height = Inches(8.5), Inches(11)
sec.top_margin, sec.bottom_margin = Inches(0.72), Inches(0.9)
sec.left_margin = sec.right_margin = Inches(0.62)

# default style
st = doc.styles["Normal"]
st.font.name = SERIF
st.font.size = Pt(BODY)
st._element.rPr.rFonts.set(qn("w:eastAsia"), SERIF)
pf = st.paragraph_format
pf.space_before = Pt(0); pf.space_after = Pt(0)
pf.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
pf.line_spacing = LEAD


def set_cols(section, n, space_tw=288):
    sp = section._sectPr
    cols = sp.xpath("./w:cols")
    c = cols[0] if cols else OxmlElement("w:cols")
    c.set(qn("w:num"), str(n))
    c.set(qn("w:space"), str(space_tw))
    c.set(qn("w:equalWidth"), "1")
    if not cols:
        sp.append(c)


def para(text="", size=BODY, bold=False, italic=False, align=None,
         indent=0.0, before=0, after=0, keep=False, spacing=None):
    p = doc.add_paragraph()
    f = p.paragraph_format
    f.space_before = Pt(before); f.space_after = Pt(after)
    f.first_line_indent = Inches(indent)
    f.line_spacing_rule = WD_LINE_SPACING.MULTIPLE
    f.line_spacing = spacing if spacing else LEAD
    if align is not None:
        p.alignment = align
    if keep:
        f.keep_with_next = True
    if text:
        add_runs(p, text, size, bold, italic)
    return p


def add_runs(p, text, size=BODY, bold=False, italic=False):
    """Honour «i»…«/i» and «b»…«/b» sentinels from the extractor."""
    parts = re.split(r"(«/?[ib]»)", text)
    it, bd = italic, bold
    for part in parts:
        if part == "«i»": it = True; continue
        if part == "«/i»": it = italic; continue
        if part == "«b»": bd = True; continue
        if part == "«/b»": bd = bold; continue
        if not part:
            continue
        r = p.add_run(part)
        r.font.name = SERIF; r.font.size = Pt(size)
        r.font.italic = it; r.font.bold = bd
        r._element.rPr.rFonts.set(qn("w:eastAsia"), SERIF)


ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"]
LETTER = "ABCDEFGHIJK"

# ================= TITLE BLOCK (full width) =================
set_cols(sec, 1)
para("UniBus Live: A Real-Time Bilingual University Bus Tracking System "
     "with Reliable Dual-Source GPS Acquisition",
     size=19, bold=False, align=WD_ALIGN_PARAGRAPH.CENTER, after=10, spacing=1.0)
para("Md. Shishir Hossain, Md. Sajib Hasan, Md. Showkat Hossen",
     size=11, align=WD_ALIGN_PARAGRAPH.CENTER, after=1)
para("Department of Computer Science and Engineering",
     size=10, italic=True, align=WD_ALIGN_PARAGRAPH.CENTER, after=0)
para("NPI University of Bangladesh", size=10, italic=True,
     align=WD_ALIGN_PARAGRAPH.CENTER, after=0)
para("Manikganj, Dhaka, Bangladesh", size=10,
     align=WD_ALIGN_PARAGRAPH.CENTER, after=0)
para("mdshishirhossain3@gmail.com", size=10,
     align=WD_ALIGN_PARAGRAPH.CENTER, after=12)

# ================= TWO-COLUMN BODY =================
s2 = doc.add_section(WD_SECTION.CONTINUOUS)
s2.page_width, s2.page_height = Inches(8.5), Inches(11)
s2.top_margin, s2.bottom_margin = Inches(0.72), Inches(0.9)
s2.left_margin = s2.right_margin = Inches(0.62)
set_cols(s2, 2)

# ---- abstract & keywords ----
p = para(align=WD_ALIGN_PARAGRAPH.JUSTIFY, after=6)
r = p.add_run("Abstract—"); r.font.name = SERIF; r.font.size = Pt(BODY - 0.5)
r.font.bold = True; r.font.italic = True
add_runs(p, C["abstract"], size=BODY - 0.5, bold=True)

p = para(align=WD_ALIGN_PARAGRAPH.JUSTIFY, after=8)
r = p.add_run("Index Terms—"); r.font.name = SERIF; r.font.size = Pt(BODY - 0.5)
r.font.bold = True; r.font.italic = True
add_runs(p, C["keywords"], size=BODY - 0.5, bold=True)


# ---- float helpers ----
def add_image(path, width_in, caption, full=False):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.keep_with_next = True
    p.add_run().add_picture(path, width=Inches(width_in))
    cp = para(caption, size=SMALL, align=WD_ALIGN_PARAGRAPH.JUSTIFY,
              after=8, spacing=0.98)
    return cp


def style_table(tbl, size):
    tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    for row in tbl.rows:
        for cell in row.cells:
            for p in cell.paragraphs:
                p.paragraph_format.space_before = Pt(1)
                p.paragraph_format.space_after = Pt(1)
                p.paragraph_format.line_spacing = 1.0
                for r in p.runs:
                    r.font.name = SERIF; r.font.size = Pt(size)


def hline(cell, where="bottom", sz=8):
    tcPr = cell._tc.get_or_add_tcPr()
    borders = tcPr.find(qn("w:tcBorders"))
    if borders is None:
        borders = OxmlElement("w:tcBorders"); tcPr.append(borders)
    el = OxmlElement(f"w:{where}")
    el.set(qn("w:val"), "single"); el.set(qn("w:sz"), str(sz))
    el.set(qn("w:color"), "000000")
    borders.append(el)


def table_caption(num, title):
    para(f"TABLE {num}", size=SMALL, align=WD_ALIGN_PARAGRAPH.CENTER,
         before=6, after=0, keep=True)
    para(title, size=SMALL, align=WD_ALIGN_PARAGRAPH.CENTER,
         after=3, keep=True, italic=False)


def algorithm_box():
    para("Algorithm 1  Estimating the ETA to every upcoming stop",
         size=SMALL, bold=True, before=6, after=2, keep=True)
    lines = [
        ("Require:", " current bus GPS fix; ordered route stops; recent average speed"),
        ("Ensure:", " an ETA and a confidence label for each stop ahead"),
        ("1:", " Compute each stop's distance from the route start (cumulative)"),
        ("2:", " Project the bus fix onto the nearest route segment to find how far "
                "along the route it has travelled (its progress)"),
        ("3:", " if recent average speed ≥ 5 km/h then"),
        ("4:", "     speed ← recent average speed"),
        ("5:", " else"),
        ("6:", "     speed ← 20 km/h        ▷ fallback default"),
        ("7:", " end if"),
        ("8:", " for all stops ahead of the bus do"),
        ("9:", "     remaining ← (stop's distance) − (progress)"),
        ("10:", "    ETA ← remaining / speed"),
        ("11:", " end for"),
        ("12:", " Assign a confidence (High/Medium/Low) from the speed quality"),
        ("13:", " if the nearest stop is within 80 m then"),
        ("14:", "     mark it reached and notify subscribed riders"),
        ("15:", " end if"),
        ("16:", " return the ETA and confidence for every stop ahead"),
    ]
    for i, (n, t) in enumerate(lines):
        p = para(before=0, after=0, spacing=0.95)
        r = p.add_run(n); r.font.name = SERIF; r.font.size = Pt(SMALL)
        r.font.bold = n.endswith(":") and not n[0].isdigit()
        r2 = p.add_run(t); r2.font.name = SERIF; r2.font.size = Pt(SMALL)
        if i in (0, 1):
            r2.font.italic = False
    para(size=SMALL, after=6)


def datamodel_fig():
    doms = [("Identity & Auth", "User, Session, Role, OTP"),
            ("Fleet & Devices", "Bus, GpsDevice, Assignment"),
            ("Routing & Schedule", "Route, Stop, RouteStop, Schedule"),
            ("Trip & Tracking", "Trip, LocationLog, TrackingState"),
            ("Comms & Passenger", "Notification, Favorite, Occupancy"),
            ("Audit & Ops", "AuditLog, TripEvent, IngestLog")]
    tbl = doc.add_table(rows=3, cols=2)
    tbl.style = "Table Grid"
    for i, (h, b) in enumerate(doms):
        cell = tbl.cell(i // 2, i % 2)
        cell.text = ""
        p0 = cell.paragraphs[0]
        r = p0.add_run(h); r.font.bold = True
        p1 = cell.add_paragraph(); p1.add_run(b)
    style_table(tbl, SMALL - 0.5)
    para("Fig. 3. The 31-model relational schema, grouped into six functional "
         "domains.", size=SMALL, align=WD_ALIGN_PARAGRAPH.JUSTIFY,
         before=3, after=8, spacing=0.98)


def table_I():
    table_caption("I", "PILOT DEPLOYMENT SUMMARY")
    rows = [("Quantity", "Value"),
            ("Deployment span", "7 weeks"), ("Routes", "9"), ("Buses", "3"),
            ("Registered passengers", "38"), ("Completed trips", "71"),
            ("Raw GPS reports ingested", "46,548"),
            ("In-trip fixes retained", "864"),
            ("Mean GPS fixes per trip", "37.6")]
    tbl = doc.add_table(rows=len(rows), cols=2)
    for i, (a, b) in enumerate(rows):
        tbl.cell(i, 0).text = a; tbl.cell(i, 1).text = b
        tbl.cell(i, 1).paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.RIGHT
        if i == 0:
            for j in (0, 1):
                tbl.cell(i, j).paragraphs[0].runs[0].font.bold = True
                hline(tbl.cell(i, j), "top"); hline(tbl.cell(i, j), "bottom")
        if i == len(rows) - 1:
            for j in (0, 1):
                hline(tbl.cell(i, j), "bottom")
    style_table(tbl, SMALL)
    para(size=SMALL, after=6)


def table_II():
    table_caption("II", "IDLE-REPORTING EFFICIENCY OPTIMIZATION")
    rows = [("Layer", "Parameter", "Before", "After"),
            ("Device (GT06S)", "Parked report interval", "5 s", "300 s"),
            ("Server", "Idle poll interval", "8 s", "60 s")]
    tbl = doc.add_table(rows=3, cols=4)
    for i, r4 in enumerate(rows):
        for j, v in enumerate(r4):
            tbl.cell(i, j).text = v
            if j >= 2:
                tbl.cell(i, j).paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.RIGHT
            if i == 0:
                tbl.cell(i, j).paragraphs[0].runs[0].font.bold = True
                hline(tbl.cell(i, j), "top"); hline(tbl.cell(i, j), "bottom")
            if i == 2:
                hline(tbl.cell(i, j), "bottom")
    style_table(tbl, SMALL)
    para(size=SMALL, after=6)


# ---- walk the extracted sections ----
sec_i = -1
sub_i = 0
subsub_i = 0
for s in C["sections"]:
    k, title = s["kind"], s["title"]
    if k == "section":
        sec_i += 1; sub_i = 0
        para(f"{ROMAN[sec_i]}.  {title.upper()}", size=BODY,
             align=WD_ALIGN_PARAGRAPH.CENTER, before=8, after=3, keep=True)
    elif k == "subsection":
        sub_i += 1; subsub_i = 0
        para(f"{LETTER[sub_i-1]}. {title}", size=BODY, italic=True,
             before=5, after=2, keep=True)
    else:
        subsub_i += 1
        para(f"{subsub_i}) {title}:", size=BODY, italic=True,
             before=3, after=1, keep=True)

    for idx, ptxt in enumerate(s["paras"]):
        if ptxt.startswith("•ITEM•"):
            p = para(align=WD_ALIGN_PARAGRAPH.JUSTIFY, before=1, after=1)
            p.paragraph_format.left_indent = Inches(0.14)
            p.paragraph_format.first_line_indent = Inches(-0.10)
            add_runs(p, "• " + ptxt.replace("•ITEM•", "").strip(), size=BODY)
        else:
            para(ptxt, align=WD_ALIGN_PARAGRAPH.JUSTIFY,
                 indent=0.16 if idx > 0 or k != "section" else 0.16, after=1)

    # ---- floats anchored to their sections ----
    if title == "System Architecture":
        add_image("arch.png", FIGW,
                  "Fig. 1. UniBus Live system architecture. The GPS tracker is the "
                  "primary, fully automatic source; the driver's smartphone is only a "
                  "fallback. All backend components share one low-cost cloud server.")
        add_image("flow.png", FIGW - 0.25,
                  "Fig. 2. Real-time data flow: the life of one position report, from "
                  "the GPS fix on the bus to the passenger's screen, grouped into "
                  "acquisition, processing, and delivery phases. Steps 3–5 are detailed "
                  "in Sections IV-A–IV-C.")
    if title == "Application Server":
        datamodel_fig()
    if title == "Location Ingestion and Multi-Source Arbitration":
        add_image("screens.png", FIGW,
                  "Fig. 4. The bilingual passenger application. (a) live tracking of a "
                  "moving bus with the next-stop ETA; (b) on-route status showing the "
                  "next stop and current speed; (c) today's schedules; (d) the in-app "
                  "English/Bangla language toggle. Place names render in both scripts.")
    if title == "Arrival-Time Estimation":
        algorithm_box()
    if title == "Deployment and Dataset":
        table_I()
    if title.startswith("Discussion"):
        table_II()

# ---- acknowledgment ----
para("ACKNOWLEDGMENT", size=BODY, align=WD_ALIGN_PARAGRAPH.CENTER,
     before=8, after=3, keep=True)
para(C["ack"], align=WD_ALIGN_PARAGRAPH.JUSTIFY, indent=0.16, after=2)

# ---- references ----
para("REFERENCES", size=BODY, align=WD_ALIGN_PARAGRAPH.CENTER,
     before=8, after=3, keep=True)
for i, b in enumerate(C["bib"], 1):
    p = para(align=WD_ALIGN_PARAGRAPH.JUSTIFY, before=0, after=1, spacing=0.95)
    p.paragraph_format.left_indent = Inches(0.18)
    p.paragraph_format.first_line_indent = Inches(-0.18)
    add_runs(p, f"[{i}] " + b, size=SMALL)

doc.save("UniBus_Live_Paper.docx")
print(f"saved docx  (body={BODY}pt lead={LEAD} figw={FIGW}in)")
