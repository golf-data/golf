import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { toolResult } from "../src/presentation.js";

test("complete scorecard survives model presentation without duplicating auxiliary data", () => {
  const holes = Array.from({ length: 18 }, (_, i) => ({ holeId: i + 101, holeNumber: i + 1, par: 4, yardage: 400 + i, allocation: 18 - i, holeDataStats: { extra: "x".repeat(10000) } }));
  const original = { publicId: "sample", courses: [{ tees: [{ teeName: "Black", holes: holes.slice(0, 9) }, { teeName: "Black", holes: holes.slice(9) }] }] };
  const result = toolResult(original);
  const presented = JSON.parse(result.content[0].text);
  assert.equal(presented.courses[0].tees.flatMap((t: { holes: unknown[] }) => t.holes).length, 18);
  assert.deepEqual(presented.courses[0].tees[1].holes[8], {holeId:118, holeNumber:18, par:4, yardage:417, allocation:1});
  assert.ok(result.content[0].text.length < 3000);
  assert.strictEqual(result._meta?.golfRawResult, original);
});

test("compressed geometry is summarized honestly, preserving original data", () => {
  const shapes = [{ holeId: 1, gpsType: "GreenTrace", shapes: [[{ latitude: 1, longitude: 2 }]] }, { holeId: 2, gpsType: "GreenTrace", shapes: [] }, { holeId: 2, gpsType: "WaterTrace", shapes: [] }];
  const original = { publicId: "sample", data: gzipSync(JSON.stringify(shapes)).toString("base64") };
  const result = toolResult(original);
  const summary = JSON.parse(result.content[0].text);
  assert.equal(summary.geometry.recordCount, 3);
  assert.equal(summary.geometry.holeCount, 2);
  assert.deepEqual(summary.geometry.countsByType, { GreenTrace: 2, WaterTrace: 1 });
  assert.match(summary.geometry.note, /summary only/);
  assert.strictEqual(result._meta?.golfRawResult, original);
});

test("malformed compressed data does not hide remaining course fields", () => {
  const result = JSON.parse(toolResult({ publicId: "sample", name: "Course", data: "broken" }).content[0].text);
  assert.equal(result.name, "Course");
  assert.match(result.geometryNote, /could not be summarized/);
});

test("non-course responses retain their original content", () => {
  const original = { results: [{ publicId: "sample" }], count: 1 };
  assert.deepEqual(JSON.parse(toolResult(original).content[0].text), original);
  assert.equal(toolResult(original)._meta, undefined);
});
