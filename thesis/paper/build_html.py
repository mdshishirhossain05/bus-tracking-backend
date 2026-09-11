"""Render the IEEE-style paper to HTML (-> Chromium -> PDF). Text comes from content.json."""
import json, re, sys, html, base64, os

C = json.load(open("content.json"))
FS   = float(sys.argv[1]) if len(sys.argv) > 1 else 9.6      # body pt
LH   = float(sys.argv[2]) if len(sys.argv) > 2 else 1.06     # line-height
FIGS = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0      # figure scale
SMALL = FS - 1.4
TINY  = FS - 1.7

ROMAN  = ["I", "II", "III", "IV", "V", "VI", "VII"]
LETTER = "ABCDEFGHIJK"


def esc(t):
    t = html.escape(t, quote=False)
    t = t.replace("«i»", "<i>").replace("«/i»", "</i>")
    t = t.replace("«b»", "<b>").replace("«/b»", "</b>")
    return t


def b64(path):
    ext = "png" if path.endswith(".png") else "jpeg"
    return f"data:image/{ext};base64," + base64.b64encode(open(path, "rb").read()).decode()


FIG1 = ("Fig. 1. UniBus Live system architecture. The GPS tracker is the primary, "
        "fully automatic source; the driver's smartphone is only a fallback. All "
        "backend components share one low-cost cloud server.")
FIG2 = ("Fig. 2. Real-time data flow: the life of one position report, from the GPS "
        "fix on the bus to the passenger's screen, grouped into acquisition, "
        "processing, and delivery phases. Steps 3&ndash;5 are detailed in "
        "Sections IV-A&ndash;IV-C.")
FIG3 = ("Fig. 3. The 31-model relational schema, grouped into six functional domains.")
FIG4 = ("Fig. 4. The bilingual passenger application. (a) live tracking of a moving "
        "bus with the next-stop ETA; (b) on-route status showing the next stop and "
        "current speed; (c) today's schedules; (d) the in-app English/Bangla language "
        "toggle. Place names render in both scripts.")

ALGO = [
    ("<b>Require:</b>", " current bus GPS fix; ordered route stops; recent average speed"),
    ("<b>Ensure:</b>", " an ETA and a confidence label for each stop ahead"),
    ("1:", " Compute each stop's distance from the route start (cumulative)"),
    ("2:", " Project the bus fix onto the nearest route segment to find how far along "
            "the route it has travelled (its <i>progress</i>)"),
    ("3:", " <b>if</b> recent average speed &ge; 5&thinsp;km/h <b>then</b>"),
    ("4:", "&nbsp;&nbsp;&nbsp;&nbsp;<i>speed</i> &larr; recent average speed"),
    ("5:", " <b>else</b>"),
    ("6:", "&nbsp;&nbsp;&nbsp;&nbsp;<i>speed</i> &larr; 20&thinsp;km/h "
           "<span class='cmt'>&#9655; fallback default</span>"),
    ("7:", " <b>end if</b>"),
    ("8:", " <b>for all</b> stops ahead of the bus <b>do</b>"),
    ("9:", "&nbsp;&nbsp;&nbsp;&nbsp;<i>remaining</i> &larr; (stop's distance) &minus; (progress)"),
    ("10:", "&nbsp;&nbsp;&nbsp;&nbsp;ETA &larr; <i>remaining</i> / <i>speed</i>"),
    ("11:", " <b>end for</b>"),
    ("12:", " Assign a confidence (High/Medium/Low) from the speed quality"),
    ("13:", " <b>if</b> the nearest stop is within 80&thinsp;m <b>then</b>"),
    ("14:", "&nbsp;&nbsp;&nbsp;&nbsp;mark it reached and notify subscribed riders"),
    ("15:", " <b>end if</b>"),
    ("16:", " <b>return</b> the ETA and confidence for every stop ahead"),
]

TABLE1 = [("Deployment span", "7 weeks"), ("Routes", "9"), ("Buses", "3"),
          ("Registered passengers", "38"), ("Completed trips", "71"),
          ("Raw GPS reports ingested", "46,548"), ("In-trip fixes retained", "864"),
          ("Mean GPS fixes per trip", "37.6")]

DOMAINS = [("Identity &amp; Auth", "User, Session, Role, OTP"),
           ("Fleet &amp; Devices", "Bus, GpsDevice, Assignment"),
           ("Routing &amp; Schedule", "Route, Stop, RouteStop, Schedule"),
           ("Trip &amp; Tracking", "Trip, LocationLog, TrackingState"),
           ("Comms &amp; Passenger", "Notification, Favorite, Occupancy"),
           ("Audit &amp; Ops", "AuditLog, TripEvent, IngestLog")]

out = []
A = out.append

A(f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>
@page {{ size: letter; margin: 0.70in 0.62in 0.80in 0.62in; }}
* {{ box-sizing: border-box; }}
html,body {{ margin:0; padding:0; }}
body {{ font-family:'Liberation Serif','Times New Roman',Times,serif;
  font-size:{FS}pt; line-height:{LH}; color:#000;
  text-align:justify; -webkit-hyphens:auto; hyphens:auto;
  hyphenate-limit-chars: 6 3 3; }}
.head {{ column-span:all; text-align:center; margin:0 0 9pt; }}
.title {{ font-size:19pt; line-height:1.14; margin:0 0 9pt; }}
.auth {{ font-size:11pt; margin:0 0 1pt; }}
.aff  {{ font-size:10pt; font-style:italic; margin:0; }}
.loc  {{ font-size:10pt; margin:0; }}
.cols {{ column-count:2; column-gap:0.2in; }}
p {{ margin:0; text-indent:0.16in; orphans:2; widows:2; }}
p.first {{ text-indent:0; }}
.abs {{ font-size:{FS-0.4}pt; font-weight:bold; text-indent:0; margin:0 0 5pt; }}
.abs .lead {{ font-style:italic; }}
h2 {{ font-size:{FS}pt; font-weight:normal; text-align:center;
     text-transform:uppercase; margin:7pt 0 3pt; page-break-after:avoid; }}
h3 {{ font-size:{FS}pt; font-weight:normal; font-style:italic; text-align:left;
     margin:5pt 0 2pt; page-break-after:avoid; }}
h4 {{ font-size:{FS}pt; font-weight:normal; font-style:italic; text-align:left;
     margin:3pt 0 1pt; display:inline; page-break-after:avoid; }}
ul {{ margin:2pt 0 2pt 0; padding-left:12pt; }}
li {{ margin:0 0 2pt; text-align:justify; }}
figure {{ margin:6pt 0 7pt; text-align:center; break-inside:avoid; }}
figure img {{ width:100%; }}
figcaption {{ font-size:{SMALL}pt; text-align:justify; margin-top:3pt;
   line-height:1.05; }}
.wide {{ column-span:all; }}
.wide img {{ width:82%; }}
table.dat {{ border-collapse:collapse; width:100%; font-size:{SMALL}pt;
   margin:0 auto; }}
table.dat th, table.dat td {{ padding:1.2pt 3pt; }}
table.dat thead th {{ border-top:0.9pt solid #000; border-bottom:0.6pt solid #000;
   font-weight:bold; }}
table.dat tbody tr:last-child td {{ border-bottom:0.9pt solid #000; }}
td.num, th.num {{ text-align:right; }}
.tabwrap {{ break-inside:avoid; margin:6pt 0 7pt; }}
.tcap {{ font-size:{SMALL}pt; text-align:center; margin-bottom:3pt;
   font-variant:small-caps; }}
.algo {{ break-inside:avoid; border-top:0.9pt solid #000; border-bottom:0.9pt solid #000;
   margin:6pt 0 7pt; padding:2pt 0; font-size:{SMALL}pt; line-height:1.12; }}
.algo .ttl {{ font-weight:bold; border-bottom:0.5pt solid #000; padding-bottom:1.5pt;
   margin-bottom:1.5pt; text-align:left; }}
.algo div.ln {{ text-align:left; text-indent:0; }}
.algo .n {{ display:inline-block; min-width:13pt; }}
.cmt {{ font-style:italic; }}
.dm {{ width:100%; border-collapse:collapse; font-size:{TINY}pt; }}
.dm td {{ border:0.5pt solid #444; padding:2.5pt 3pt; vertical-align:top;
   text-align:left; width:50%; }}
.dm b {{ display:block; }}
h2.ref {{ margin-top:8pt; }}
ol.refs {{ margin:0; padding:0; list-style:none; font-size:{SMALL}pt;
   line-height:1.06; }}
ol.refs li {{ padding-left:13pt; text-indent:-13pt; margin-bottom:1.5pt;
   text-align:justify; }}
</style></head><body>""")

# ---------------- title ----------------
A(f"""<div class="head">
<div class="title">UniBus Live: A Real-Time Bilingual University Bus Tracking
System with Reliable Dual-Source GPS Acquisition</div>
<div class="auth">Md. Shishir Hossain, Md. Sajib Hasan, Md. Showkat Hossen</div>
<div class="aff">Department of Computer Science and Engineering</div>
<div class="aff">NPI University of Bangladesh</div>
<div class="loc">Manikganj, Dhaka, Bangladesh</div>
<div class="loc">mdshishirhossain3@gmail.com</div>
</div>""")

A('<div class="cols">')
A(f'<p class="abs"><span class="lead">Abstract&mdash;</span>{esc(C["abstract"])}</p>')
A(f'<p class="abs"><span class="lead">Index Terms&mdash;</span>{esc(C["keywords"])}</p>')


def fig(src, cap, wide=False, scale=1.0):
    cls = "wide" if wide else ""
    style = "" if wide else f' style="width:{scale*100:.0f}%"'
    A(f'<figure class="{cls}"><img src="{b64(src)}"{style}>'
      f'<figcaption>{cap}</figcaption></figure>')


def algo_box():
    A('<div class="algo"><div class="ttl">Algorithm 1&nbsp; Estimating the ETA to '
      'every upcoming stop</div>')
    for n, t in ALGO:
        A(f'<div class="ln"><span class="n">{n}</span>{t}</div>')
    A('</div>')


def table1():
    A('<div class="tabwrap"><div class="tcap">Table I<br>Pilot Deployment Summary</div>')
    A('<table class="dat"><thead><tr><th>Quantity</th><th class="num">Value</th>'
      '</tr></thead><tbody>')
    for a, b in TABLE1:
        A(f'<tr><td>{a}</td><td class="num">{b}</td></tr>')
    A('</tbody></table></div>')


def table2():
    A('<div class="tabwrap"><div class="tcap">Table II<br>'
      'Idle-Reporting Efficiency Optimization</div>')
    A('<table class="dat"><thead><tr><th>Layer</th><th>Parameter</th>'
      '<th class="num">Before</th><th class="num">After</th></tr></thead><tbody>')
    for r in [("Device (GT06S)", "Parked report interval", "5&thinsp;s", "300&thinsp;s"),
              ("Server", "Idle poll interval", "8&thinsp;s", "60&thinsp;s")]:
        A(f'<tr><td>{r[0]}</td><td>{r[1]}</td><td class="num">{r[2]}</td>'
          f'<td class="num">{r[3]}</td></tr>')
    A('</tbody></table></div>')


def datamodel():
    A('<figure><table class="dm">')
    for i in range(0, 6, 2):
        A("<tr>")
        for h, b in DOMAINS[i:i + 2]:
            A(f"<td><b>{h}</b>{b}</td>")
        A("</tr>")
    A(f'</table><figcaption>{FIG3}</figcaption></figure>')


sec_i, sub_i, subsub_i = -1, 0, 0
for s in C["sections"]:
    k, title = s["kind"], s["title"]
    if k == "section":
        sec_i += 1; sub_i = 0
        A(f"<h2>{ROMAN[sec_i]}.&nbsp;&nbsp;{esc(title)}</h2>")
    elif k == "subsection":
        sub_i += 1; subsub_i = 0
        A(f"<h3>{LETTER[sub_i-1]}. {esc(title)}</h3>")
    else:
        subsub_i += 1
        runin = f"<i>{subsub_i}) {esc(title)}:</i> "

    items = []
    first = True
    runin = runin if k == "subsubsection" else ""
    for ptxt in s["paras"]:
        if ptxt.startswith("•ITEM•"):
            items.append(esc(ptxt.replace("•ITEM•", "").strip()))
            continue
        if items:
            A("<ul>" + "".join(f"<li>{x}</li>" for x in items) + "</ul>")
            items = []
        cls = ' class="first"' if first else ""
        A(f"<p{cls}>{runin}{esc(ptxt)}</p>")
        runin = ""
        first = False
    if items:
        A("<ul>" + "".join(f"<li>{x}</li>" for x in items) + "</ul>")

    if title == "System Architecture":
        fig("arch.png", FIG1, scale=1.0 * FIGS)
        fig("flow.png", FIG2, scale=0.92 * FIGS)
    if title == "Application Server":
        datamodel()
    if title == "Location Ingestion and Multi-Source Arbitration":
        fig("screens.png", FIG4, wide=True)
    if title == "Arrival-Time Estimation":
        algo_box()
    if title == "Deployment and Dataset":
        table1()
    if title.startswith("Discussion"):
        table2()

A("<h2>Acknowledgment</h2>")
A(f'<p class="first">{esc(C["ack"])}</p>')
A('<h2 class="ref">References</h2><ol class="refs">')
for b in C["bib"]:
    A(f"<li>{esc(b)}</li>")
A("</ol></div></body></html>")

open("paper.html", "w").write("\n".join(out))
print(f"html written (fs={FS} lh={LH} figs={FIGS})")
