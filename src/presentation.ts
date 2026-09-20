import { gunzipSync } from "node:zlib";

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function pick(value: RecordValue, keys: string[]) {
  return Object.fromEntries(keys.filter(k => value[k] !== undefined).map(k => [k, value[k]]));
}

/** Keep large source payloads available to clients without flooding model context. */
export function coursePresentation(value: unknown): unknown {
  if (!record(value) || typeof value.publicId !== "string") return value;
  const summary = pick(value, ["publicId", "name", "updatedOn", "courseGroupId", "facility", "courseArchitect", "yearOpened", "guestPolicyTypeId", "courseEnvironmentTypeId", "isElevationData", "tileSets", "courseGroupDataStats", "isActive"]);
  if (Array.isArray(value.holes)) {
    const columns = ["holeId", "holeNumber", "holeName", "holeType", "teeGPSCoordinate", "approachGPSCoordinate", "greenGPSCoordinate"];
    summary.holes = value.holes.filter(record).map(h => pick(h, columns));
  }
  if (Array.isArray(value.courses)) {
    summary.courses = value.courses.filter(record).map(course => ({
      ...pick(course, ["courseId", "name", "courseHoleType", "courseStatusType"]),
      tees: Array.isArray(course.tees) ? course.tees.filter(record).map(tee => ({
        ...pick(tee, ["teeId", "teeName", "courseTeeType", "teeType", "isTeeActive", "par", "yardage", "slope", "rating"]),
        holes: Array.isArray(tee.holes) ? tee.holes.filter(record).map(h => pick(h, ["holeId", "holeNumber", "par", "yardage", "allocation"])) : [],
      })) : [],
    }));
  }
  if (Array.isArray(value.layouts)) {
    summary.layouts = value.layouts.filter(record).map(layout => ({
      ...pick(layout, ["layoutId", "layoutName", "layoutType"]),
      holeIds: Array.isArray(layout.holes) ? layout.holes.filter(record).map(h => h.holeId) : [],
    }));
  }
  let geometry: unknown = value.gpsItems;
  if (typeof value.data === "string" && value.data) {
    try {
      geometry = JSON.parse(gunzipSync(Buffer.from(value.data, "base64"), { maxOutputLength: 16 * 1024 * 1024 }).toString("utf8"));
    } catch {
      summary.geometryNote = "Compressed geometry could not be summarized; original payload is retained in result metadata.";
    }
  }
  if (Array.isArray(geometry)) {
    const counts: Record<string, number> = {};
    const holeIds = new Set<unknown>();
    for (const item of geometry.filter(record)) {
      const type = String(item.gpsType ?? "Unknown");
      counts[type] = (counts[type] ?? 0) + 1;
      if (item.holeId !== undefined) holeIds.add(item.holeId);
    }
    summary.geometry = { recordCount: geometry.length, holeCount: holeIds.size, countsByType: counts, note: "Geometry summary only. Full shapes remain in the original payload in result metadata; do not infer shape coordinates from counts." };
  }
  summary.presentationNote = "Compact course data for model context. All returned tee score rows are included; allocation is the source handicap field. Original API payload, including detailed geometry and auxiliary fields, is retained in _meta.golfRawResult for clients.";
  return summary;
}

export function toolResult(value: unknown) {
  const presented = coursePresentation(value);
  return {
    content: [{ type: "text" as const, text: typeof presented === "string" ? presented : JSON.stringify(presented) }],
    ...(presented === value ? {} : { _meta: { golfRawResult: value } }),
  };
}
