import { useLayoutEffect, useRef, type JSX } from "react";

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { linter, lintGutter, lintKeymap, type Diagnostic as CodeMirrorDiagnostic } from "@codemirror/lint";
import { MergeView } from "@codemirror/merge";
import { searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { type LocalInjectionDiagnostic } from "../../../core/local-injection-document";

type LocalInjectionCodeEditorProps = Readonly<{
  draftId: string;
  value: string;
  source: string | null;
  compareOpen: boolean;
  diagnostics: readonly LocalInjectionDiagnostic[];
  tabIndents: boolean;
  readOnly: boolean;
  onChange(value: string): void;
}>;

type EditorHandle = {
  draftId: string;
  merge: MergeView | null;
  view: EditorView;
  diagnostics: Compartment;
  tabs: Compartment;
};

const workbenchJsonHighlightStyle = HighlightStyle.define([
  { tag: [tags.propertyName, tags.attributeName], color: "var(--wb-code-property)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--wb-code-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--wb-code-value)" },
  { tag: [tags.punctuation, tags.separator], color: "var(--wb-code-punctuation)" },
  { tag: [tags.invalid], color: "var(--wb-error)", textDecoration: "underline wavy" }
]);

function editorDiagnostics(
  diagnostics: readonly LocalInjectionDiagnostic[],
  documentLength: number
): CodeMirrorDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    from: 0,
    to: Math.min(documentLength, Math.max(1, documentLength)),
    severity: diagnostic.severity,
    message: `${diagnostic.category.toUpperCase()}${diagnostic.path ? ` · ${diagnostic.path}` : ""}: ${diagnostic.message}`
  }));
}

function commonExtensions(
  label: string,
  diagnosticCompartment: Compartment,
  tabCompartment: Compartment,
  diagnostics: readonly LocalInjectionDiagnostic[],
  tabIndents: boolean,
  readOnly: boolean,
  onChange?: (value: string) => void
) {
  return [
    json(),
    syntaxHighlighting(workbenchJsonHighlightStyle),
    bracketMatching(),
    foldGutter(),
    history(),
    lintGutter(),
    diagnosticCompartment.of(linter((view) => editorDiagnostics(diagnostics, view.state.doc.length), { delay: 0 })),
    tabCompartment.of(tabIndents ? keymap.of([indentWithTab]) : []),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, ...lintKeymap]),
    EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "false" }),
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    ...(onChange ? [EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange(update.state.doc.toString());
    })] : [])
  ];
}

/** CodeMirror stays mounted for the lifetime of one Draft so editor state survives every presentation change. */
export function LocalInjectionCodeEditor({
  draftId,
  value,
  source,
  compareOpen,
  diagnostics,
  tabIndents,
  readOnly,
  onChange
}: LocalInjectionCodeEditorProps): JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const handle = useRef<EditorHandle | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useLayoutEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const diagnosticCompartment = new Compartment();
    const tabCompartment = new Compartment();
    const draftExtensions = commonExtensions(
      "Local Injection JSON",
      diagnosticCompartment,
      tabCompartment,
      diagnostics,
      tabIndents,
      readOnly,
      (next) => onChangeRef.current(next)
    );
    if (source !== null) {
      const sourceDiagnostics = new Compartment();
      const sourceTabs = new Compartment();
      const merge = new MergeView({
        a: {
          doc: source,
          extensions: commonExtensions(
            "Immutable Injection Source JSON",
            sourceDiagnostics,
            sourceTabs,
            [],
            false,
            true
          )
        },
        b: { doc: value, extensions: draftExtensions },
        parent,
        highlightChanges: compareOpen,
        gutter: compareOpen,
        collapseUnchanged: compareOpen ? { margin: 3, minSize: 6 } : undefined,
        diffConfig: { scanLimit: 5_000, timeout: 250 }
      });
      handle.current = { draftId, merge, view: merge.b, diagnostics: diagnosticCompartment, tabs: tabCompartment };
    } else {
      const view = new EditorView({
        state: EditorState.create({ doc: value, extensions: draftExtensions }),
        parent
      });
      handle.current = { draftId, merge: null, view, diagnostics: diagnosticCompartment, tabs: tabCompartment };
    }
    return () => {
      handle.current?.merge?.destroy();
      if (!handle.current?.merge) handle.current?.view.destroy();
      handle.current = null;
    };
  }, [draftId]);

  useLayoutEffect(() => {
    const editor = handle.current;
    if (!editor) return;
    const current = editor.view.state.doc.toString();
    if (current !== value) {
      editor.view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  useLayoutEffect(() => {
    const editor = handle.current;
    if (!editor) return;
    editor.view.dispatch({
      effects: [
        editor.diagnostics.reconfigure(
          linter((view) => editorDiagnostics(diagnostics, view.state.doc.length), { delay: 0 })
        ),
        editor.tabs.reconfigure(tabIndents ? keymap.of([indentWithTab]) : [])
      ]
    });
  }, [diagnostics, tabIndents]);

  useLayoutEffect(() => {
    handle.current?.merge?.reconfigure({
      highlightChanges: compareOpen,
      gutter: compareOpen,
      collapseUnchanged: compareOpen ? { margin: 3, minSize: 6 } : undefined,
      diffConfig: { scanLimit: 5_000, timeout: 250 }
    });
  }, [compareOpen]);

  return <div
    className="workbench-react__local-code"
    data-compare-open={compareOpen || undefined}
    data-editor-engine="codemirror-6"
    ref={host}
  />;
}
