import * as fs from "node:fs";
import * as path from "node:path";
import { paths } from "../config/paths.js";

interface ShareOpts {
  verbose?: boolean;
  out?: string;
}

interface FieldSummary {
  topic: string;
  paperCount: number;
  subfields: string[];
  overview: string;
  readingOrder: string[];
  cost: string | null;
}

function fieldDirFor(slug: string): string {
  return path.join(paths.home(), "notes", "fields", slug);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function readField(slug: string): FieldSummary | null {
  const dir = fieldDirFor(slug);
  if (!fs.existsSync(dir)) return null;

  const overviewPath = path.join(dir, "overview.md");
  const readingPath = path.join(dir, "reading-order.md");
  if (!fs.existsSync(overviewPath)) return null;

  const overview = fs.readFileSync(overviewPath, "utf-8");

  const titleMatch = overview.match(/^#\s+(.+)$/m);
  const topic = titleMatch?.[1]?.trim() ?? slug;

  const paperCountMatch = overview.match(/(\d+)\s+papers?/i);
  const paperCount = paperCountMatch ? parseInt(paperCountMatch[1]!, 10) : 0;

  const subfields: string[] = [];
  const sfRegex = /^##\s+(?!Overview|Reading|Open|References|Open problems)([^\n]+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = sfRegex.exec(overview)) !== null) {
    subfields.push(m[1]!.trim());
  }

  const readingOrder: string[] = [];
  if (fs.existsSync(readingPath)) {
    const reading = fs.readFileSync(readingPath, "utf-8");
    const lines = reading.split(/\r?\n/);
    for (const line of lines) {
      const numMatch = line.match(/^\s*\d+\.\s+(.+)$/);
      if (numMatch) readingOrder.push(numMatch[1]!.trim());
      if (readingOrder.length >= 10) break;
    }
  }

  return {
    topic,
    paperCount,
    subfields: subfields.slice(0, 8),
    overview,
    readingOrder,
    cost: null,
  };
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtml(f: FieldSummary): string {
  const subfieldsHtml = f.subfields.length
    ? f.subfields
        .map((s, i) => `<li><span class="num">${i + 1}.</span> ${esc(s)}</li>`)
        .join("\n        ")
    : "<li><em>no subfields detected</em></li>";

  const readingHtml = f.readingOrder.length
    ? f.readingOrder
        .slice(0, 10)
        .map((r, i) => `<li><span class="num">${i + 1}.</span> ${esc(r)}</li>`)
        .join("\n        ")
    : "<li><em>(no reading list saved — run peer next to build one)</em></li>";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>I mapped ${esc(f.topic)} with peer</title>
<meta name="description" content="A field map of ${esc(f.topic)} — ${f.paperCount} papers, ${f.subfields.length} subfields. Generated with peer, a terminal-native research agent." />
<style>
  :root {
    --bg: #06070a; --fg: #e8e4d8; --dim: #8a8f9a; --dim2: #5a6473;
    --accent: #d4a574; --term: #0b0e14;
    --mono: 'JetBrains Mono','SF Mono','Menlo',monospace;
    --serif: 'Cormorant Garamond','Playfair Display',Georgia,serif;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: var(--bg); color: var(--fg); font-family: var(--mono); -webkit-font-smoothing: antialiased; }
  body {
    background: radial-gradient(ellipse at top, #0a0d18 0%, #04050a 80%);
    min-height: 100vh; padding: 5vh 6vw 8vh;
  }
  .container { max-width: 800px; margin: 0 auto; }
  .badge {
    display: inline-block;
    font-size: 0.75rem; color: var(--accent);
    border: 1px solid rgba(212,165,116,0.3);
    padding: 4px 10px; border-radius: 999px;
    letter-spacing: 0.1em; text-transform: uppercase;
    margin-bottom: 24px;
  }
  h1 {
    font-family: var(--serif); font-size: clamp(2.4rem, 6vw, 4.4rem);
    font-weight: 400; letter-spacing: -0.02em; line-height: 1.05;
    color: var(--fg); margin-bottom: 14px;
  }
  h1 em { color: var(--accent); font-style: italic; }
  .meta {
    color: var(--dim); font-size: 0.95rem; letter-spacing: 0.04em;
    margin-bottom: 6vh;
  }
  h2 {
    font-family: var(--mono); font-size: 0.85rem;
    color: var(--accent); letter-spacing: 0.12em;
    text-transform: uppercase;
    margin-top: 6vh; margin-bottom: 2vh;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  ol, ul { list-style: none; padding: 0; }
  li {
    color: var(--fg); font-size: 1.02rem; line-height: 1.7;
    padding: 6px 0;
    border-bottom: 1px solid rgba(255,255,255,0.03);
  }
  li:last-child { border-bottom: none; }
  .num { color: var(--dim2); margin-right: 12px; display: inline-block; min-width: 22px; }
  .footer {
    margin-top: 14vh; padding-top: 5vh;
    border-top: 1px solid rgba(255,255,255,0.06);
    text-align: center; color: var(--dim2);
    font-size: 0.9rem; line-height: 1.8;
  }
  .footer .cta {
    font-family: var(--serif); font-size: 1.6rem;
    font-style: italic; color: var(--fg);
    display: block; margin-bottom: 14px;
  }
  .footer code {
    background: rgba(212,165,116,0.08); color: var(--accent);
    padding: 2px 8px; border-radius: 4px;
  }
  .footer a { color: var(--dim); border-bottom: 1px dashed var(--dim2); text-decoration: none; }
  .footer a:hover { color: var(--fg); }
</style>
</head>
<body>
<div class="container">

  <div class="badge">field map</div>
  <h1>I mapped <em>${esc(f.topic)}</em><br/>with peer.</h1>
  <div class="meta">${f.paperCount} papers · ${f.subfields.length} subfields · generated locally · no private notes shared</div>

  <h2>subfields</h2>
  <ol>
        ${subfieldsHtml}
  </ol>

  <h2>top reading order</h2>
  <ol>
        ${readingHtml}
  </ol>

  <div class="footer">
    <span class="cta">make your own.</span>
    <code>curl -fsSL https://raw.githubusercontent.com/KeWang0622/peer/main/scripts/install/install.sh | sh</code><br/>
    <a href="https://github.com/KeWang0622/peer">github.com/KeWang0622/peer</a> · peer is a research agent that lives in your terminal
  </div>

</div>
</body>
</html>
`;
}

export async function cmdShare(rawTopic: string | null, opts: ShareOpts = {}): Promise<void> {
  if (!rawTopic) {
    console.error('Usage: peer share "<topic>"');
    console.error("Generates a shareable HTML page from a field map you've already run with `peer map`.");
    process.exit(1);
  }

  const slug = slugify(rawTopic);
  const field = readField(slug);

  if (!field) {
    console.error(`\npeer: no field map found for "${rawTopic}"`);
    console.error(`Expected at: ${fieldDirFor(slug)}/overview.md`);
    console.error(`\nRun this first: peer map "${rawTopic}"`);
    process.exit(1);
  }

  const html = buildHtml(field);
  const outDir = path.join(paths.home(), "shares");
  fs.mkdirSync(outDir, { recursive: true });

  const outPath = opts.out ?? path.join(outDir, `${slug}.html`);
  fs.writeFileSync(outPath, html, "utf-8");

  console.log(`\n✓ Shareable page saved.`);
  console.log(`  → ${outPath}`);
  console.log(`  ${field.paperCount} papers · ${field.subfields.length} subfields`);
  console.log(`\nTo share:`);
  console.log(`  - open ${outPath} in a browser to preview`);
  console.log(`  - drag the file to a tweet, slack, lab chat`);
  console.log(`  - or host it: any static host (GitHub Pages, Vercel, Cloudflare) works\n`);
  console.log(`Tip: the page contains paper titles + subfields only — your private notes stay local.\n`);
}
