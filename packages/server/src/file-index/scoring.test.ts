import { describe, expect, test } from "bun:test";
import { quickOpenFromEntries, toEntry } from "./scoring";

function buildEntries(paths: string[]) {
  return paths.map(toEntry);
}

describe("scoring", () => {
  test("should prioritize shorter and filename matches", () => {
    const entries = buildEntries([
      "app.tsx",
      "src/app.tsx",
      "src/application.tsx",
      "src/components/apple.tsx",
      "documentation/app-guide.md",
    ]);

    const results = quickOpenFromEntries(entries, "app", 10);
    const paths = results.map((r) => r.path);

    // 1. app.tsx (exact filename match, shallowest)
    expect(paths[0]).toBe("app.tsx");

    // 2. src/app.tsx (exact filename match, deeper)
    expect(paths[1]).toBe("src/app.tsx");

    // All prefix matches should be in top 5
    expect(paths).toContain("src/application.tsx");
    expect(paths).toContain("src/components/apple.tsx");
    expect(paths).toContain("documentation/app-guide.md");

    expect(paths.indexOf("src/application.tsx")).toBeLessThan(5);
    expect(paths.indexOf("src/components/apple.tsx")).toBeLessThan(5);
    expect(paths.indexOf("documentation/app-guide.md")).toBeLessThan(5);
  });

  test("should prioritize consecutive matches", () => {
    const entries = buildEntries(["abc.ts", "a-b-c.ts", "axbycz.ts"]);

    const results = quickOpenFromEntries(entries, "abc", 10);
    const paths = results.map((r) => r.path);

    // axbycz should definitely be last (scattered matches)
    expect(paths[2]).toBe("axbycz.ts");
  });
});
