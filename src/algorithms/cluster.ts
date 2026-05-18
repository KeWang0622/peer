/**
 * Pure-TS agglomerative clustering with cosine distance + average linkage.
 *
 * We use this in lieu of HDBSCAN (avoiding a Python dependency).
 * For N ≤ ~500, O(N^2 log N) is fine on a researcher's laptop.
 *
 * API: cluster(vectors, k) → labels[]
 */

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 1;
  return 1 - dot / denom;
}

/**
 * Cluster vectors into exactly k clusters using agglomerative average linkage.
 * Returns an array of integer labels [0, k), one per input vector.
 */
export function cluster(vectors: number[][], k: number): number[] {
  const n = vectors.length;
  if (n === 0) return [];
  if (k >= n) return vectors.map((_, i) => i);
  if (k <= 1) return vectors.map(() => 0);

  // Start: each point its own cluster
  const clusters: number[][] = vectors.map((_, i) => [i]);
  // Precompute pairwise distances between cluster centroids
  const centroids = vectors.map((v) => v.slice());

  while (clusters.length > k) {
    // Find closest pair of clusters
    let bestI = 0;
    let bestJ = 1;
    let bestD = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const ci = centroids[i]!;
        const cj = centroids[j]!;
        const d = cosineDistance(ci, cj);
        if (d < bestD) {
          bestD = d;
          bestI = i;
          bestJ = j;
        }
      }
    }

    // Merge bestJ into bestI
    const ci = clusters[bestI]!;
    const cj = clusters[bestJ]!;
    const merged = ci.concat(cj);
    clusters[bestI] = merged;

    // Recompute centroid (average of all member vectors)
    const newCentroid = new Array(vectors[0]!.length).fill(0) as number[];
    for (const idx of merged) {
      const v = vectors[idx]!;
      for (let d = 0; d < v.length; d++) {
        newCentroid[d] = (newCentroid[d] ?? 0) + (v[d] ?? 0);
      }
    }
    for (let d = 0; d < newCentroid.length; d++) {
      newCentroid[d] = (newCentroid[d] ?? 0) / merged.length;
    }
    centroids[bestI] = newCentroid;

    // Remove bestJ
    clusters.splice(bestJ, 1);
    centroids.splice(bestJ, 1);
  }

  // Assign labels
  const labels = new Array(n).fill(-1) as number[];
  for (let c = 0; c < clusters.length; c++) {
    for (const idx of clusters[c]!) {
      labels[idx] = c;
    }
  }
  return labels;
}

/**
 * Within a cluster, find the member closest to the centroid.
 * Returns the index in the original vectors array.
 */
export function clusterCentroidMember(
  vectors: number[][],
  labels: number[],
  clusterLabel: number,
): number {
  const members: number[] = [];
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === clusterLabel) members.push(i);
  }
  if (members.length === 0) return -1;
  if (members.length === 1) return members[0]!;

  const dim = vectors[members[0]!]!.length;
  const centroid = new Array(dim).fill(0) as number[];
  for (const idx of members) {
    const v = vectors[idx]!;
    for (let d = 0; d < dim; d++) {
      centroid[d] = (centroid[d] ?? 0) + (v[d] ?? 0);
    }
  }
  for (let d = 0; d < dim; d++) {
    centroid[d] = (centroid[d] ?? 0) / members.length;
  }

  let best = members[0]!;
  let bestD = Infinity;
  for (const idx of members) {
    const d = cosineDistance(vectors[idx]!, centroid);
    if (d < bestD) {
      bestD = d;
      best = idx;
    }
  }
  return best;
}

/** Suggested k given N papers — fewer subareas for small libraries. */
export function suggestedK(n: number): number {
  if (n < 20) return 2;
  if (n < 50) return 3;
  if (n < 100) return 4;
  if (n < 200) return 5;
  return 6;
}
