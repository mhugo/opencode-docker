import assert from "node:assert/strict"
import test from "node:test"

import { shQuote } from "../src/quote.js"

test("wraps a plain string in single quotes", () => {
  assert.equal(shQuote("echo hi"), "'echo hi'")
})

test("escapes embedded single quotes", () => {
  assert.equal(shQuote("it's"), "'it'\\''s'")
})

test("preserves newlines, pipes and redirections as one argument", () => {
  assert.equal(shQuote("a | b > c\nls"), "'a | b > c\nls'")
})

test("quotes the empty string", () => {
  assert.equal(shQuote(""), "''")
})
