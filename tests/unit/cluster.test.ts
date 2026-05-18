import { test } from "node:test";
import assert from "node:assert/strict";
import { cluster, clusterCentroidMember, suggestedK } from "../../src/algorithms/cluster.ts";

test("cluster: 4 well-separated points into 2 clusters", () => {
  const vectors = [
    [1, 0, 0],
    [0.9, 0.1, 0],
    [0, 0, 1],
    [0, 0.1, 0.9],
  ];
  const labels = cluster(vectors, 2);
  assert.equal(labels.length, 4);
  // First two should be same label, last two same label
  assert.equal(labels[0], labels[1]);
  assert.equal(labels[2], labels[3]);
  assert.notEqual(labels[0], labels[2]);
});

test("cluster: k=1 puts everything in one cluster", () => {
  const labels = cluster(
    [
      [1, 0],
      [0, 1],
      [1, 1],
    ],
    1,
  );
  assert.deepEqual(new Set(labels), new Set([0]));
});

test("cluster: k>=N gives each point its own cluster", () => {
  const labels = cluster(
    [
      [1, 0],
      [0, 1],
    ],
    5,
  );
  assert.equal(new Set(labels).size, 2);
});

test("cluster: empty input returns empty", () => {
  assert.deepEqual(cluster([], 3), []);
});

test("clusterCentroidMember: returns one of the members", () => {
  const vectors = [
    [1, 0],
    [0.95, 0.05],
    [0, 1],
  ];
  const labels = [0, 0, 1];
  const idx = clusterCentroidMember(vectors, labels, 0);
  assert.ok(idx === 0 || idx === 1);
});

test("suggestedK monotonically increases with N", () => {
  assert.ok(suggestedK(10) <= suggestedK(50));
  assert.ok(suggestedK(50) <= suggestedK(100));
  assert.ok(suggestedK(100) <= suggestedK(500));
});
