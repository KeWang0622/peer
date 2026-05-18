import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

/**
 * All filesystem paths used by prof.
 * Override base via PROF_HOME env var (used in tests).
 */
export const profHome = (): string =>
  process.env.PROF_HOME ?? path.join(os.homedir(), ".prof");

export const paths = {
  home: profHome,
  db: () => path.join(profHome(), "prof.db"),
  settings: () => path.join(profHome(), "settings.toml"),
  auth: () => path.join(profHome(), "auth.json"),
  notes: () => path.join(profHome(), "notes"),
  papersNotes: () => path.join(profHome(), "notes", "papers"),
  conceptsNotes: () => path.join(profHome(), "notes", "concepts"),
  fieldsNotes: () => path.join(profHome(), "notes", "fields"),
  ideasNotes: () => path.join(profHome(), "notes", "ideas"),
  pdfCache: () => path.join(profHome(), "pdf-cache"),
  profile: () => path.join(profHome(), "profile.md"),
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
