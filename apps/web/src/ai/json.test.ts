import { describe, expect, it } from "vitest"
import { extractJson } from "./json.ts"

describe("extractJson", () => {
  it("reads a bare object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })

  it("reads a fenced block, which models produce however firmly you ask them not to", () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```\nHope that helps.')).toEqual({ a: 1 })
  })

  it("digs an object out of surrounding prose", () => {
    expect(extractJson('Sure. {"a":[1,2]} — let me know.')).toEqual({ a: [1, 2] })
  })

  it("reads a bare array", () => {
    expect(extractJson("[1,2,3]")).toEqual([1, 2, 3])
  })

  it("returns null rather than half an answer", () => {
    expect(extractJson("no json at all")).toBeNull()
    expect(extractJson('{"a":')).toBeNull()
  })
})
