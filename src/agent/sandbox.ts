import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  createReadTool,
  createGrepTool,
  createFindTool,
  createLsTool,
  createWriteTool,
  createEditTool,
  type EditOperations,
  type WriteOperations,
} from "@earendil-works/pi-coding-agent";

type Tool = AgentTool<any>;

function jailed(home: string) {
  const root = path.resolve(home);
  return (p: string): string => {
    const abs = path.isAbsolute(p) ? p : path.resolve(root, p);
    const resolved = path.resolve(abs);
    const rel = path.relative(root, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(
        `peer: refusing file operation outside ${root} (attempted: ${resolved})`,
      );
    }
    return resolved;
  };
}

export function createSandboxedTools(home: string): Tool[] {
  const check = jailed(home);

  const writeOps: WriteOperations = {
    writeFile: async (absolutePath: string, content: string) => {
      const safe = check(absolutePath);
      await fs.writeFile(safe, content);
    },
    mkdir: async (dir: string) => {
      const safe = check(dir);
      await fs.mkdir(safe, { recursive: true });
    },
  };

  const editOps: EditOperations = {
    readFile: async (absolutePath: string) => {
      const safe = check(absolutePath);
      return fs.readFile(safe);
    },
    writeFile: async (absolutePath: string, content: string) => {
      const safe = check(absolutePath);
      await fs.writeFile(safe, content);
    },
    access: async (absolutePath: string) => {
      const safe = check(absolutePath);
      await fs.access(safe);
    },
  };

  return [
    createReadTool(home),
    createGrepTool(home),
    createFindTool(home),
    createLsTool(home),
    createWriteTool(home, { operations: writeOps }),
    createEditTool(home, { operations: editOps }),
  ];
}
