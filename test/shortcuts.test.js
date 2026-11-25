import assert from "node:assert/strict";
import { test } from "node:test";
import { bindingsFor, conflictingCommand, defaultBindings, isEditableCommand, isShortcutBinding } from "../server/shortcut-bindings.js";

test("shortcut bindings accept canonical chords and plain sequences", () => {
  for (const binding of ["?", "+", "ctrl++", "ctrl+shift+x", "alt+F8", "z shift+u"]) {
    assert.equal(isShortcutBinding(binding), true, binding);
  }
  for (const binding of ["", "X", "g ctrl+j", "a b c", "Escape", "ArrowDown", "shift+?", "meta+ctrl+x"]) {
    assert.equal(isShortcutBinding(binding), false, binding);
  }
  for (const command of Object.keys(defaultBindings).filter(isEditableCommand)) {
    assert.ok(defaultBindings[command].every(isShortcutBinding), command);
    assert.equal(conflictingCommand({}, command), undefined, command);
  }
});

test("conflicts include fixed commands, sequences and effective overrides", () => {
  assert.equal(conflictingCommand({ "next-file": "g" }, "next-file"), "file-browser");
  assert.equal(conflictingCommand({ "next-file": "g c" }, "next-file"), "recent-commit");
  assert.equal(conflictingCommand({ "next-file": "g z" }, "next-file"), undefined);
  assert.equal(conflictingCommand({ "next-file": "ctrl+Enter" }, "next-file"), "save-comment");
  assert.deepEqual(bindingsFor("next-file", { "next-file": null }), []);
  assert.equal(conflictingCommand({ "next-file": null, "previous-file": "j" }, "previous-file"), undefined);
  assert.equal(conflictingCommand({ "previous-file": "j" }, "next-file"), "previous-file");
});
