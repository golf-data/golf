import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// One public showcase course, served from a static snapshot stored in the
// deploy. Anonymous callers never reach the Golf Intelligence API and never
// spend credits. There is intentionally no list endpoint.
export const SAMPLE_PUBLIC_ID = "225V2ANM"; // Torrey Pines South Golf Course

const SAMPLE_DIR = resolve("public/sample", SAMPLE_PUBLIC_ID);
let cached: string | undefined;

export function sampleCourseJson(): string {
  cached ??= readFileSync(resolve(SAMPLE_DIR, "course.json"), "utf8");
  return cached;
}

export function sampleGreenPath(file: string): string | undefined {
  const match = /^hole-([1-9]|1[0-8])\.png$/.exec(file);
  return match ? resolve(SAMPLE_DIR, "greens", file) : undefined;
}
