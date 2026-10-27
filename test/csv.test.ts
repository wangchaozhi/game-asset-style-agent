import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { csvCell, toCsv } from "../src/export/csv.js";

describe("csv", () => {
  it("quotes cells with separators, quotes or line breaks", () => {
    assert.equal(csvCell("plain"), "plain");
    assert.equal(csvCell('a,"b"'), '"a,""b"""');
    assert.equal(csvCell("two\nlines"), '"two\nlines"');
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(42), "42");
  });

  it("defuses cells that a spreadsheet would run as a formula", () => {
    for (const s of ["=1+1", "+cmd", "-2", "@SUM(A1)", "\tx"]) assert.ok(csvCell(s).replace(/^"/, "").startsWith("'"), s);
    assert.equal(csvCell("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
  });

  it("starts with a BOM and uses CRLF rows", () => {
    assert.equal(toCsv([["a", "b"], [1, 2]]), "﻿a,b\r\n1,2\r\n");
  });
});
