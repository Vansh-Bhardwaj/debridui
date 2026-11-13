import { describe, expect, test } from "bun:test";
import { closestInDirection, restoreFocusIndex } from "../components/tv/focus-selection";

const rect = (left: number, top: number, width = 100, height = 100) => ({ left, top, width, height });

describe("TV spatial focus", () => {
    test("left/right stay in the physical row before considering diagonal cards", () => {
        expect(closestInDirection(rect(0, 0), [rect(110, 150), rect(300, 0)], "right")).toBe(1);
        expect(closestInDirection(rect(300, 0), [rect(190, 150), rect(0, 0)], "left")).toBe(1);
    });
    test("up/down preserve the column", () => {
        expect(closestInDirection(rect(0, 0), [rect(150, 110), rect(0, 300)], "down")).toBe(1);
        expect(closestInDirection(rect(0, 300), [rect(150, 190), rect(0, 0)], "up")).toBe(1);
    });
    test("diagonal fallback works and edges do not wrap", () => {
        expect(closestInDirection(rect(0, 0), [rect(150, 150)], "down")).toBe(0);
        expect(closestInDirection(rect(0, 0), [rect(150, 150)], "left")).toBe(-1);
        expect(closestInDirection(rect(0, 0), [], "up")).toBe(-1);
    });
    test("ignores the current card and near-identical centers", () => {
        expect(closestInDirection(rect(0, 0), [rect(0, 0), rect(5, 0), rect(110, 0)], "right")).toBe(2);
    });
    test("restores the opener by identity after cards reorder", () => {
        expect(restoreFocusIndex([{ key: "second" }, { key: "opener" }], { key: "opener", index: 0 })).toBe(1);
    });
    test("removed openers use the closest surviving index; new pages start at content", () => {
        expect(restoreFocusIndex([{ key: "remaining" }], { key: "removed", index: 5 })).toBe(0);
        expect(restoreFocusIndex([{ key: "primary" }])).toBe(0);
        expect(restoreFocusIndex([])).toBe(-1);
    });
});
