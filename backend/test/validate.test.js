import { describe, it, expect } from "vitest";
import {
  validateCoords,
  validateRadius,
  validateLimit,
  BadRequestError,
} from "../src/lib/validate.js";
import { NYC_BOUNDS } from "../src/config/constants.js";

describe("validateCoords", () => {
  it("accepts numbers and returns them parsed", () => {
    expect(validateCoords({ lat: 40.7484, lng: -73.9857 })).toEqual({
      lat: 40.7484,
      lng: -73.9857,
    });
  });

  it("accepts numeric strings, since query params arrive as strings", () => {
    expect(validateCoords({ lat: "40.7484", lng: "-73.9857" })).toEqual({
      lat: 40.7484,
      lng: -73.9857,
    });
  });

  it.each([
    ["missing lat", { lng: -73.9857 }, "missing_lat"],
    ["missing lng", { lat: 40.7484 }, "missing_lng"],
    ["null lat", { lat: null, lng: -73.9857 }, "missing_lat"],
    // Number("") === 0, which would otherwise pass as a coordinate on the equator.
    ["empty-string lat", { lat: "", lng: -73.9857 }, "missing_lat"],
    ["non-numeric lat", { lat: "abc", lng: -73.9857 }, "invalid_lat"],
    ["NaN lng", { lat: 40.7484, lng: NaN }, "invalid_lng"],
    ["Infinity lng", { lat: 40.7484, lng: Infinity }, "invalid_lng"],
  ])("rejects %s", (_label, input, expectedCode) => {
    expect(() => validateCoords(input)).toThrowError(BadRequestError);
    try {
      validateCoords(input);
    } catch (err) {
      expect(err.message).toBe(expectedCode);
      expect(err.status).toBe(400);
    }
  });

  it.each([
    ["north of NYC", { lat: 41.5, lng: -73.9857 }],
    ["south of NYC", { lat: 40.0, lng: -73.9857 }],
    ["west of NYC", { lat: 40.7484, lng: -75.0 }],
    ["east of NYC", { lat: 40.7484, lng: -70.0 }],
    // Lat/lng swapped is the single most likely frontend bug; it must 400,
    // not silently score some point in the ocean.
    ["swapped lat/lng", { lat: -73.9857, lng: 40.7484 }],
  ])("rejects coordinates %s as out_of_bounds", (_label, input) => {
    expect(() => validateCoords(input)).toThrowError(/out_of_bounds/);
  });

  it("accepts the exact corners of the bounding box", () => {
    const { minLat, maxLat, minLng, maxLng } = NYC_BOUNDS;
    expect(() => validateCoords({ lat: minLat, lng: minLng })).not.toThrow();
    expect(() => validateCoords({ lat: maxLat, lng: maxLng })).not.toThrow();
  });
});

describe("validateRadius", () => {
  it("falls back when the value is absent", () => {
    for (const absent of [undefined, null, ""]) {
      expect(validateRadius(absent, { fallback: 350 })).toBe(350);
    }
  });

  it("parses a numeric string", () => {
    expect(validateRadius("500", { fallback: 350 })).toBe(500);
  });

  it.each([
    ["zero", "0"],
    ["negative", "-10"],
    ["above the cap", "5000"],
  ])("rejects %s", (_label, value) => {
    expect(() => validateRadius(value, { fallback: 350 })).toThrowError(
      /invalid_radius/
    );
  });

  it("honours a custom max", () => {
    expect(validateRadius("900", { fallback: 350, max: 1000 })).toBe(900);
    expect(() => validateRadius("1200", { fallback: 350, max: 1000 })).toThrow();
  });

  it("rejects a non-numeric radius", () => {
    expect(() => validateRadius("wide", { fallback: 350 })).toThrowError(
      /invalid_radius/
    );
  });
});

describe("validateLimit", () => {
  const opts = { fallback: 1000, max: 5000 };

  it("falls back when absent", () => {
    for (const absent of [undefined, null, ""]) {
      expect(validateLimit(absent, opts)).toBe(1000);
    }
  });

  it("parses a numeric string", () => {
    expect(validateLimit("250", opts)).toBe(250);
  });

  it.each([
    ["zero", "0"],
    ["negative", "-1"],
    ["above the cap", "5001"],
    ["fractional", "1.5"],
    ["non-numeric", "lots"],
  ])("rejects %s", (_label, value) => {
    expect(() => validateLimit(value, opts)).toThrowError(/invalid_limit/);
  });
});
