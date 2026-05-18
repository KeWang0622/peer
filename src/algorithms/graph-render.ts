/**
 * Build the knowledge-graph data (nodes + edges) from the local SQLite DB
 * and render a single self-contained HTML file using D3.js v7 (CDN).
 *
 * The HTML file is fully standalone — once written, the user can open it
 * directly in any modern browser. No additional JS/CSS files are produced.
 *
 * Slogan: "Research is a journey." — this is the visual map of that journey.
 */
import { db } from "../db/client.js";

// --- Types ---------------------------------------------------------------

export type GraphNodeType = "paper" | "concept" | "author";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  year: number | null;
  citationCount: number;
  /** Optional extra payload used for hover panels (papers only). */
  title?: string;
  abstract?: string | null;
  venue?: string | null;
}

export interface GraphEdge {
  source: string;
  target: string;
  /** e.g. 'introduces' | 'uses' | 'mentions' | 'authored' | 'cites' */
  type: string;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Total paper count across the library (used to decide whether the lib is too small). */
  paperCount: number;
}

interface PaperLite {
  id: string;
  title: string;
  abstract: string | null;
  year: number | null;
  venue: string | null;
  citations_count: number;
}

interface ConceptLite {
  id: string;
  name: string;
  first_year: number | null;
}

interface PaperConceptLite {
  paper_id: string;
  concept_id: string;
  relation: string;
}

interface AuthorLite {
  id: string;
  name: string;
}

interface AuthoredLite {
  paper_id: string;
  author_id: string;
  position: number;
}

// --- Graph build ---------------------------------------------------------

/**
 * Read the DB and produce a JSON-ready graph payload.
 *
 * - All papers become paper nodes.
 * - All concepts referenced by at least one paper become concept nodes.
 * - The top-30 papers (by citation_count, ties broken by recency) get their
 *   authors as nodes + `authored` edges. We deliberately limit author nodes
 *   to keep the graph readable.
 */
export function buildKnowledgeGraph(): KnowledgeGraph {
  const d = db();

  const papers = d
    .prepare<[], PaperLite>(
      `SELECT id, title, abstract, year, venue, citations_count
       FROM papers
       ORDER BY citations_count DESC, year DESC`,
    )
    .all();

  const paperConcepts = d
    .prepare<[], PaperConceptLite>(
      `SELECT paper_id, concept_id, relation FROM paper_concepts`,
    )
    .all();

  // Only keep concepts that are actually linked to a paper in our library.
  const linkedConceptIds = new Set<string>();
  for (const pc of paperConcepts) linkedConceptIds.add(pc.concept_id);

  const conceptIdList = [...linkedConceptIds];
  const concepts: ConceptLite[] = conceptIdList.length
    ? (d
        .prepare(
          `SELECT id, name, first_year FROM concepts WHERE id IN (${conceptIdList
            .map(() => "?")
            .join(",")})`,
        )
        .all(...conceptIdList) as ConceptLite[])
    : [];

  // Top-30 papers — pull their author edges only.
  const topPaperIds = papers.slice(0, 30).map((p) => p.id);

  let authoredRows: AuthoredLite[] = [];
  let authorRows: AuthorLite[] = [];
  if (topPaperIds.length > 0) {
    const placeholders = topPaperIds.map(() => "?").join(",");
    authoredRows = d
      .prepare(
        `SELECT paper_id, author_id, position FROM authored
         WHERE paper_id IN (${placeholders})`,
      )
      .all(...topPaperIds) as AuthoredLite[];

    const authorIds = [...new Set(authoredRows.map((a) => a.author_id))];
    if (authorIds.length > 0) {
      const authorPlaceholders = authorIds.map(() => "?").join(",");
      authorRows = d
        .prepare(
          `SELECT id, name FROM authors WHERE id IN (${authorPlaceholders})`,
        )
        .all(...authorIds) as AuthorLite[];
    }
  }

  // --- Assemble nodes ---
  const nodes: GraphNode[] = [];

  for (const p of papers) {
    nodes.push({
      id: p.id,
      type: "paper",
      label: truncate(p.title, 90),
      title: p.title,
      abstract: p.abstract,
      year: p.year,
      venue: p.venue,
      citationCount: p.citations_count ?? 0,
    });
  }

  for (const c of concepts) {
    nodes.push({
      id: c.id,
      type: "concept",
      label: c.name,
      year: c.first_year,
      citationCount: 0,
    });
  }

  for (const a of authorRows) {
    nodes.push({
      id: a.id,
      type: "author",
      label: a.name,
      year: null,
      citationCount: 0,
    });
  }

  // --- Assemble edges ---
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = [];

  for (const pc of paperConcepts) {
    if (nodeIds.has(pc.paper_id) && nodeIds.has(pc.concept_id)) {
      edges.push({ source: pc.paper_id, target: pc.concept_id, type: pc.relation });
    }
  }

  for (const a of authoredRows) {
    if (nodeIds.has(a.paper_id) && nodeIds.has(a.author_id)) {
      edges.push({ source: a.author_id, target: a.paper_id, type: "authored" });
    }
  }

  // Citation edges between papers in the library (if any exist in `cites`).
  try {
    const cites = d
      .prepare<[], { from_paper: string; to_paper: string }>(
        `SELECT from_paper, to_paper FROM cites`,
      )
      .all();
    for (const c of cites) {
      if (nodeIds.has(c.from_paper) && nodeIds.has(c.to_paper)) {
        edges.push({ source: c.from_paper, target: c.to_paper, type: "cites" });
      }
    }
  } catch {
    // cites table missing in some older DBs — best-effort.
  }

  return { nodes, edges, paperCount: papers.length };
}

// --- HTML render ---------------------------------------------------------

/**
 * Render a single self-contained HTML page that visualizes the graph with
 * D3.js v7 (force-directed layout, year/concept filters, hover panel).
 */
export function renderGraphHtml(graph: KnowledgeGraph): string {
  // We JSON.stringify with conservative escaping so the payload is safe to
  // embed in a <script> tag (escape </ to avoid breaking out of the tag).
  const payload = JSON.stringify(graph).replace(/<\//g, "<\\/");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>prof graph — your research journey</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<script src="https://d3js.org/d3.v7.min.js"></script>
<style>
  :root {
    --bg: #0b0d12;
    --panel: #141821;
    --muted: #8892a6;
    --text: #e6ecf5;
    --primary: #6ea8ff;      /* papers */
    --accent:  #ffb86b;      /* concepts */
    --author:  #a0e4a0;      /* authors */
    --edge:    #3a4252;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; height: 100%; width: 100%;
    background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
    overflow: hidden;
  }
  #app { position: relative; width: 100vw; height: 100vh; }
  svg  { width: 100%; height: 100%; cursor: grab; }
  svg:active { cursor: grabbing; }

  .legend, .controls, .hover {
    position: absolute; background: rgba(20,24,33,0.92);
    border: 1px solid #232936; border-radius: 8px;
    padding: 12px 14px; font-size: 13px; backdrop-filter: blur(8px);
  }
  .legend { top: 16px; left: 16px; }
  .controls { top: 16px; right: 16px; min-width: 260px; }
  .hover {
    bottom: 16px; left: 16px; right: 16px; max-width: 720px;
    margin: 0 auto; max-height: 35vh; overflow-y: auto;
    display: none;
  }
  .hover.show { display: block; }

  h1 { font-size: 14px; margin: 0 0 8px; letter-spacing: 0.5px; color: var(--text); }
  .slogan { font-size: 11px; color: var(--muted); margin-top: 2px; font-style: italic; }
  .row { display: flex; align-items: center; gap: 6px; margin: 4px 0; color: var(--muted); }
  .swatch { width: 12px; height: 12px; border-radius: 50%; }
  .swatch.paper { background: var(--primary); }
  .swatch.concept { background: var(--accent); }
  .swatch.author { background: var(--author); }

  label { display: block; margin: 8px 0 4px; color: var(--muted); font-size: 12px; }
  select, input[type=range] { width: 100%; background: #1a1f2b; color: var(--text);
    border: 1px solid #2a3142; border-radius: 4px; padding: 4px 6px; font-size: 12px; }
  .stats { color: var(--muted); margin-top: 8px; font-size: 11px; }

  .hover .title { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 4px; }
  .hover .meta  { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
  .hover .abstract { font-size: 12px; line-height: 1.5; color: #c2cad8; }
  .hover .dismiss { float: right; color: var(--muted); cursor: pointer; font-size: 16px; }

  .node text { font-size: 10px; fill: var(--text); pointer-events: none;
    text-shadow: 0 1px 2px rgba(0,0,0,0.6); }
  .link { stroke: var(--edge); stroke-opacity: 0.55; }
  .link.authored { stroke: #4a5366; stroke-dasharray: 2 3; }
  .link.cites    { stroke: #6ea8ff; stroke-opacity: 0.25; }

  .empty { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
    color: var(--muted); text-align: center; }
</style>
</head>
<body>
<div id="app">
  <svg id="canvas"></svg>

  <div class="legend">
    <h1>prof graph</h1>
    <div class="slogan">Research is a journey.</div>
    <div class="row" style="margin-top:8px;"><span class="swatch paper"></span> papers</div>
    <div class="row"><span class="swatch concept"></span> concepts</div>
    <div class="row"><span class="swatch author"></span> authors</div>
  </div>

  <div class="controls">
    <label for="yearMin">Min year: <span id="yearMinVal">—</span></label>
    <input type="range" id="yearMin" min="1900" max="2030" value="1900" />

    <label for="conceptFilter">Filter by concept</label>
    <select id="conceptFilter"><option value="">— all —</option></select>

    <div class="stats" id="stats">—</div>
  </div>

  <div class="hover" id="hover">
    <span class="dismiss" id="hoverDismiss">×</span>
    <div class="title" id="hoverTitle"></div>
    <div class="meta"  id="hoverMeta"></div>
    <div class="abstract" id="hoverAbstract"></div>
  </div>
</div>

<script>
const GRAPH = ${payload};

const COLORS = {
  paper:   getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#6ea8ff',
  concept: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()  || '#ffb86b',
  author:  getComputedStyle(document.documentElement).getPropertyValue('--author').trim()  || '#a0e4a0',
};

// year-aware tint: older = darker, newer = brighter
const yearScale = (() => {
  const years = GRAPH.nodes.filter(n => n.year).map(n => n.year);
  if (!years.length) return () => 1;
  const yMin = Math.min(...years), yMax = Math.max(...years);
  if (yMin === yMax) return () => 1;
  return (y) => 0.55 + 0.45 * ((y - yMin) / (yMax - yMin));
})();

function colorFor(n) {
  const base = COLORS[n.type] || '#888';
  if (n.type !== 'paper' || !n.year) return base;
  const t = yearScale(n.year);
  return mix('#2a2f3d', base, t);
}

function mix(a, b, t) {
  const pa = parseHex(a), pb = parseHex(b);
  const r = Math.round(pa[0] + (pb[0]-pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1]-pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2]-pa[2]) * t);
  return 'rgb(' + r + ',' + g + ',' + bl + ')';
}
function parseHex(h) {
  h = h.replace('#','');
  if (h.length === 3) h = h.split('').map(c => c+c).join('');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}

const radiusFor = (n) => {
  if (n.type === 'concept') return 6;
  if (n.type === 'author')  return 5;
  const c = Math.max(0, n.citationCount || 0);
  return 5 + Math.min(20, Math.sqrt(c) * 0.9);
};

// Populate filters
const allYears = GRAPH.nodes.filter(n => n.year).map(n => n.year);
const yMin = allYears.length ? Math.min(...allYears) : 1900;
const yMax = allYears.length ? Math.max(...allYears) : 2030;
const yearMinEl = document.getElementById('yearMin');
yearMinEl.min = yMin; yearMinEl.max = yMax; yearMinEl.value = yMin;
document.getElementById('yearMinVal').textContent = yMin;
yearMinEl.addEventListener('input', () => {
  document.getElementById('yearMinVal').textContent = yearMinEl.value;
  applyFilters();
});

const conceptSel = document.getElementById('conceptFilter');
GRAPH.nodes
  .filter(n => n.type === 'concept')
  .sort((a,b) => a.label.localeCompare(b.label))
  .forEach(c => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.label;
    conceptSel.appendChild(o);
  });
conceptSel.addEventListener('change', applyFilters);

// --- D3 force layout ---
const svg = d3.select('#canvas');
const width  = window.innerWidth;
const height = window.innerHeight;
svg.attr('viewBox', [0, 0, width, height]);

const root = svg.append('g');
svg.call(d3.zoom().scaleExtent([0.2, 4]).on('zoom', (e) => root.attr('transform', e.transform)));

const linkSel = root.append('g').attr('class','links')
  .selectAll('line')
  .data(GRAPH.edges)
  .join('line')
  .attr('class', d => 'link ' + d.type)
  .attr('stroke-width', d => d.type === 'cites' ? 0.8 : 1);

const nodeSel = root.append('g').attr('class','nodes')
  .selectAll('g')
  .data(GRAPH.nodes)
  .join('g')
  .attr('class','node')
  .call(drag());

nodeSel.append('circle')
  .attr('r', radiusFor)
  .attr('fill', colorFor)
  .attr('stroke', '#0b0d12')
  .attr('stroke-width', 1.2);

nodeSel.append('title').text(d => d.label + (d.year ? ' (' + d.year + ')' : ''));

nodeSel.filter(d => d.type !== 'paper' || (d.citationCount && d.citationCount >= 50))
  .append('text')
  .attr('dx', d => radiusFor(d) + 3)
  .attr('dy', '.35em')
  .text(d => d.label.length > 50 ? d.label.slice(0, 47) + '…' : d.label);

nodeSel.on('mouseenter', (event, d) => showHover(d))
       .on('click',      (event, d) => showHover(d));

const sim = d3.forceSimulation(GRAPH.nodes)
  .force('link', d3.forceLink(GRAPH.edges).id(d => d.id).distance(d => d.type === 'authored' ? 30 : 60).strength(0.5))
  .force('charge', d3.forceManyBody().strength(-180))
  .force('center', d3.forceCenter(width/2, height/2))
  .force('collide', d3.forceCollide().radius(d => radiusFor(d) + 4))
  .on('tick', () => {
    linkSel
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);
    nodeSel.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
  });

function drag() {
  function dragstarted(event, d) {
    if (!event.active) sim.alphaTarget(0.3).restart();
    d.fx = d.x; d.fy = d.y;
  }
  function dragged(event, d) { d.fx = event.x; d.fy = event.y; }
  function dragended(event, d) {
    if (!event.active) sim.alphaTarget(0);
    d.fx = null; d.fy = null;
  }
  return d3.drag().on('start', dragstarted).on('drag', dragged).on('end', dragended);
}

// --- Filters --------------------------------------------------------------
function applyFilters() {
  const yMin = +yearMinEl.value;
  const cFilter = conceptSel.value;
  let conceptNeighborhood = null;
  if (cFilter) {
    conceptNeighborhood = new Set([cFilter]);
    GRAPH.edges.forEach(e => {
      const sId = typeof e.source === 'object' ? e.source.id : e.source;
      const tId = typeof e.target === 'object' ? e.target.id : e.target;
      if (sId === cFilter) conceptNeighborhood.add(tId);
      if (tId === cFilter) conceptNeighborhood.add(sId);
    });
  }

  const visibleNodeIds = new Set();
  nodeSel.style('display', d => {
    let show = true;
    if (d.type === 'paper' && d.year && d.year < yMin) show = false;
    if (conceptNeighborhood && !conceptNeighborhood.has(d.id)) show = false;
    if (show) visibleNodeIds.add(d.id);
    return show ? null : 'none';
  });
  linkSel.style('display', d => {
    const sId = typeof d.source === 'object' ? d.source.id : d.source;
    const tId = typeof d.target === 'object' ? d.target.id : d.target;
    return visibleNodeIds.has(sId) && visibleNodeIds.has(tId) ? null : 'none';
  });

  document.getElementById('stats').textContent =
    visibleNodeIds.size + ' / ' + GRAPH.nodes.length + ' nodes · ' + GRAPH.edges.length + ' edges';
}

// --- Hover panel ----------------------------------------------------------
function showHover(d) {
  const hover = document.getElementById('hover');
  document.getElementById('hoverTitle').textContent = d.title || d.label;
  const metaBits = [];
  if (d.type) metaBits.push(d.type);
  if (d.year) metaBits.push(d.year);
  if (d.venue) metaBits.push(d.venue);
  if (d.citationCount) metaBits.push(d.citationCount + ' citations');
  document.getElementById('hoverMeta').textContent = metaBits.join(' · ');
  const abstract = d.abstract ? (d.abstract.length > 600 ? d.abstract.slice(0, 600) + '…' : d.abstract) : '';
  document.getElementById('hoverAbstract').textContent = abstract;
  hover.classList.add('show');
}
document.getElementById('hoverDismiss').addEventListener('click', () => {
  document.getElementById('hover').classList.remove('show');
});

applyFilters();
window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  svg.attr('viewBox', [0, 0, w, h]);
  sim.force('center', d3.forceCenter(w/2, h/2));
  sim.alpha(0.3).restart();
});
</script>
</body>
</html>
`;
}

// --- Helpers -------------------------------------------------------------

function truncate(s: string, max: number): string {
  if (!s) return s;
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
