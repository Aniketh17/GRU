// Auckland date/time helpers across NZ daylight-saving boundaries (2026-09-27 and 2027-04-04).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aucklandDate, aucklandMinutes, parseTimeToMinutes } from "../../apps/worker/src/lib/timezone.ts";

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe("aucklandDate / aucklandMinutes", () => {
  it("NZST (UTC+12): 08:30 local", () => {
    assert.equal(aucklandMinutes(at("2026-09-25T20:30:00Z")), 8 * 60 + 30);
    assert.equal(aucklandDate(at("2026-09-25T20:30:00Z")), "2026-09-26");
  });
  it("DST start 2026-09-27: 02:00 NZST jumps to 03:00 NZDT", () => {
    assert.equal(aucklandMinutes(at("2026-09-26T13:59:00Z")), 1 * 60 + 59);
    assert.equal(aucklandMinutes(at("2026-09-26T14:00:00Z")), 3 * 60);
    assert.equal(aucklandDate(at("2026-09-26T14:00:00Z")), "2026-09-27");
  });
  it("NZDT (UTC+13): 08:30 local is 19:30Z the previous day", () => {
    assert.equal(aucklandMinutes(at("2026-12-14T19:30:00Z")), 8 * 60 + 30);
    assert.equal(aucklandDate(at("2026-12-14T19:30:00Z")), "2026-12-15");
  });
  it("DST end 2027-04-04: 03:00 NZDT falls back to 02:00 NZST", () => {
    assert.equal(aucklandMinutes(at("2027-04-03T13:59:00Z")), 2 * 60 + 59);
    assert.equal(aucklandMinutes(at("2027-04-03T14:00:00Z")), 2 * 60);
  });
  it("local midnight rolls the date", () => {
    assert.equal(aucklandDate(at("2026-12-14T10:59:00Z")), "2026-12-14");
    assert.equal(aucklandDate(at("2026-12-14T11:00:00Z")), "2026-12-15");
  });
});

describe("parseTimeToMinutes", () => {
  it("parses HH:mm and falls back to 08:30", () => {
    assert.equal(parseTimeToMinutes("07:05"), 425);
    assert.equal(parseTimeToMinutes("nonsense"), 510);
  });
});
