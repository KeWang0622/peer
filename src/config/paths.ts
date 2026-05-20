import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

/**
 * All filesystem paths used by peer.
 * Override base via PEER_HOME env var (or legacy PROF_HOME).
 */
export const peerHome = (): string =>
  process.env.PEER_HOME ?? process.env.PROF_HOME ?? path.join(os.homedir(), ".peer");

// Legacy alias — some modules still call profHome()
export const profHome = peerHome;

export const paths = {
  home: peerHome,
  db: () => path.join(peerHome(), "peer.db"),
  settings: () => path.join(peerHome(), "settings.toml"),
  auth: () => path.join(peerHome(), "auth.json"),
  notes: () => path.join(peerHome(), "notes"),
  papersNotes: () => path.join(peerHome(), "notes", "papers"),
  conceptsNotes: () => path.join(peerHome(), "notes", "concepts"),
  fieldsNotes: () => path.join(peerHome(), "notes", "fields"),
  ideasNotes: () => path.join(peerHome(), "notes", "ideas"),
  pdfCache: () => path.join(peerHome(), "pdf-cache"),
  profile: () => path.join(peerHome(), "profile.md"),
};

export function ensureDirs(): void {
  const dirs = [
    paths.home(),
    paths.notes(),
    paths.papersNotes(),
    paths.conceptsNotes(),
    paths.fieldsNotes(),
    paths.ideasNotes(),
    paths.pdfCache(),
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
