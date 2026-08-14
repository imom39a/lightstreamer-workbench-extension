import { history, historyField, undoDepth } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { foldEffect, foldedRanges, foldState } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { restoredStateExtensions, serializeCodeMirrorState } from "../src/extension/panel/react/local-injection-code-editor";

describe("Local Injection CodeMirror presentation", () => {
  it("round-trips undo history and folded ranges through the Panel Session presentation", () => {
    const baseExtensions = [json(), history(), foldState];
    const initial = EditorState.create({ doc: "{\n  \"value\": 1\n}", extensions: baseExtensions });
    const changed = initial.update({
      changes: { from: initial.doc.length, insert: " " },
      effects: foldEffect.of({ from: 0, to: initial.doc.length })
    }).state;
    const serialized = serializeCodeMirrorState(changed);
    const restored = EditorState.create({
      doc: changed.doc,
      extensions: [...baseExtensions, ...restoredStateExtensions({
        cursor: changed.selection.main.head,
        selectionFrom: changed.selection.main.from,
        selectionTo: changed.selection.main.to,
        scrollTop: 0,
        scrollLeft: 0,
        compareOpen: false,
        serializedState: serialized
      }, changed.doc.toString(), baseExtensions)]
    });
    let folds = 0;
    foldedRanges(restored).between(0, restored.doc.length, () => { folds += 1; });
    expect(undoDepth(restored)).toBe(1);
    expect(folds).toBe(1);
    expect(restored.field(historyField, false)).toBeDefined();
  });
});
