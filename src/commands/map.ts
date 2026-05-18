import { profMap } from "../algorithms/field-map.js";

export async function cmdMap(topic: string, opts: { limit?: number; verbose?: boolean } = {}): Promise<void> {
  const onProgress = (step: string, detail?: string) => {
    if (opts.verbose) {
      console.log(`  · ${step}${detail ? `: ${detail}` : ""}`);
    }
  };

  console.log(`\nMapping field: "${topic}"\n`);
  const t0 = Date.now();
  const result = await profMap(topic, { limit: opts.limit, onProgress });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n✓ Mapped "${topic}" in ${elapsed}s. Cost: $${result.cost.toFixed(3)}`);
  console.log(`\n  ${result.paperCount} papers · ${result.clusterCount} subfields`);
  console.log(`  → ${result.outputDir}/\n`);
  console.log(`Try:`);
  console.log(`  cat ${result.outputDir}/overview.md`);
  console.log(`  cat ${result.outputDir}/reading-order.md\n`);
}
