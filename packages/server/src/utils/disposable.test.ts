import { describe, expect, test } from "bun:test";

import { createDisposable } from "./disposable";

describe("createDisposable", () => {
  test("flattens nested disposables", async () => {
    const order: string[] = [];
    const nested = createDisposable(() => {
      order.push("nested");
    });
    const parent = createDisposable(() => [
      nested,
      createDisposable(() => {
        order.push("inner");
      }),
    ]);

    await parent[Symbol.dispose]();
    expect(order).toEqual(["nested", "inner"]);
  });
});
