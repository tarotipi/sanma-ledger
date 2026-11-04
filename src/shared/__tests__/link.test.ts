import { describe, expect, it } from "vitest";
import { groupIdFromLink } from "../link";

describe("groupIdFromLink", () => {
  const id = "dbea0afc-26c4-48be-8485-73b74cf3e5d5";
  it("グループのリンクから取り出す", () => {
    expect(groupIdFromLink(`https://example.workers.dev/g/${id}`)).toBe(id);
  });
  it("対局の画面のリンクや前後の空白でも取り出す", () => {
    expect(groupIdFromLink(`  https://example.workers.dev/g/${id}/s/abc/record\n`)).toBe(id);
  });
  it("関係ない文字列は null", () => {
    expect(groupIdFromLink("こんにちは")).toBeNull();
    expect(groupIdFromLink("https://example.com/")).toBeNull();
  });
});
