/**
 * `peer graph` — open an interactive knowledge-graph visualization
 * of the user's library in the default browser.
 *
 * Pipeline:
 *   1. Build {nodes, edges} from the SQLite DB (papers, concepts, authors).
 *   2. Render a self-contained HTML page with D3.js (CDN).
 *   3. Write to ~/.peer/notes/graph.html.
 *   4. Try to open via `open` (mac) / `xdg-open` (linux) / `start` (windows).
 *
 * If the library is too small (< 5 papers) we bail out with a friendly
 * "go run `peer read` or `peer onboard` first" message.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { paths, ensureDirs } from "../config/paths.js";
import { buildKnowledgeGraph, renderGraphHtml } from "../algorithms/graph-render.js";

const MIN_PAPERS = 5;

export interface GraphCmdOptions {
  verbose?: boolean;
}

export async function cmdGraph(opts: GraphCmdOptions = {}): Promise<void> {
  ensureDirs();

  const log = (msg: string) => {
    if (opts.verbose) console.log(`  · ${msg}`);
  };

  log("building graph from local database");
  const graph = buildKnowledgeGraph();

  if (graph.paperCount < MIN_PAPERS) {
    console.log(`\nYour library is small (${graph.paperCount} paper${graph.paperCount === 1 ? "" : "s"}).`);
    console.log(`A knowledge graph needs at least ${MIN_PAPERS} papers to be meaningful.\n`);
    console.log(`Try:`);
    console.log(`  peer read <arxiv-id|doi|url>   — add a paper`);
    console.log(`  peer onboard                    — seed your library`);
    console.log(`\nResearch is a journey. Take the first step.\n`);
    return;
  }

  log(`assembled ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

  const html = renderGraphHtml(graph);
  const outPath = path.join(paths.notes(), "graph.html");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, "utf-8");

  const paperNodes   = graph.nodes.filter((n) => n.type === "paper").length;
  const conceptNodes = graph.nodes.filter((n) => n.type === "concept").length;
  const authorNodes  = graph.nodes.filter((n) => n.type === "author").length;

  console.log(`\n✓ Knowledge graph rendered`);
  console.log(`  ${paperNodes} papers · ${conceptNodes} concepts · ${authorNodes} authors`);
  console.log(`  ${graph.edges.length} edges`);
  console.log(`  → ${outPath}`);

  const opened = tryOpenInBrowser(outPath);
  if (opened) {
    console.log(`\n  Opening in your browser…`);
  } else {
    console.log(`\n  Open the file above in your browser to see your research journey.`);
  }
  console.log(`\n  Research is a journey. This is the map.\n`);
}

/**
 * Best-effort cross-platform browser opener.
 * Returns true if we managed to spawn a launcher process; false otherwise.
 * We never throw — failure to launch is non-fatal (we already printed the path).
 */
function tryOpenInBrowser(filePath: string): boolean {
  const platform = process.platform;
  const candidates: Array<{ cmd: string; args: string[] }> = [];

  if (platform === "darwin") {
    candidates.push({ cmd: "open", args: [filePath] });
  } else if (platform === "win32") {
    // `start` is a cmd builtin, so we route through cmd.exe.
    candidates.push({ cmd: "cmd", args: ["/c", "start", "", filePath] });
  } else {
    // linux / freebsd / etc.
    candidates.push({ cmd: "xdg-open", args: [filePath] });
    candidates.push({ cmd: "gnome-open", args: [filePath] });
  }

  for (const { cmd, args } of candidates) {
    try {
      const child = spawn(cmd, args, {
        detached: true,
        stdio: "ignore",
      });
      child.on("error", () => {
        /* ignore — fall through to next candidate on next call */
      });
      child.unref();
      return true;
    } catch {
      // try next candidate
    }
  }
  return false;
}
