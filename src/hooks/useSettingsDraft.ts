"use client";

import { useCallback, useMemo, useRef, useState } from "react";

/**
 * Transactional draft state for settings pages.
 *
 * - Holds a local draft of a settings object
 * - Tracks which fields differ from the last-saved snapshot (dirty tracking)
 * - Supports undo/redo of draft edits
 * - `markSaved` commits the draft as the new baseline after a successful save
 * - `reset` discards the draft back to the baseline
 *
 * The draft is a flat record; nested settings should be flattened by the
 * caller (e.g. "widget.enabled") so dirty tracking and field-level server
 * validation errors line up 1:1.
 */
export type SettingsValue = string | number | boolean | null;
export type SettingsDraft = Record<string, SettingsValue>;

const MAX_HISTORY = 100;

function valuesEqual(a: SettingsValue, b: SettingsValue): boolean {
  return a === b || (a === null && b === null);
}

export function useSettingsDraft(initial: SettingsDraft) {
  const [baseline, setBaseline] = useState<SettingsDraft>(initial);
  const [draft, setDraft] = useState<SettingsDraft>(initial);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });

  // Refs mirror the latest values so callbacks stay referentially stable
  const draftRef = useRef(draft);
  const baselineRef = useRef(baseline);
  const undoStack = useRef<SettingsDraft[]>([]);
  const redoStack = useRef<SettingsDraft[]>([]);

  const commit = useCallback((next: SettingsDraft) => {
    draftRef.current = next;
    setDraft(next);
    setHistory({
      canUndo: undoStack.current.length > 0,
      canRedo: redoStack.current.length > 0,
    });
  }, []);

  const dirtyFields = useMemo(() => {
    const fields = new Set<string>();
    for (const key of Object.keys(draft)) {
      if (!valuesEqual(draft[key], baseline[key])) {
        fields.add(key);
      }
    }
    return fields;
  }, [draft, baseline]);

  const isDirty = dirtyFields.size > 0;

  /** Replace baseline + draft together (e.g. after fetching fresh data). */
  const load = useCallback((next: SettingsDraft) => {
    baselineRef.current = next;
    setBaseline(next);
    undoStack.current = [];
    redoStack.current = [];
    commit(next);
  }, [commit]);

  const update = useCallback((key: string, value: SettingsValue) => {
    const prev = draftRef.current;
    if (valuesEqual(prev[key], value)) return;
    undoStack.current.push(prev);
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    redoStack.current = [];
    commit({ ...prev, [key]: value });
  }, [commit]);

  const updateMany = useCallback((patch: Partial<SettingsDraft>) => {
    const prev = draftRef.current;
    const changed = Object.entries(patch).some(
      ([key, value]) => !valuesEqual(prev[key], value as SettingsValue)
    );
    if (!changed) return;
    undoStack.current.push(prev);
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    redoStack.current = [];
    commit({ ...prev, ...patch } as SettingsDraft);
  }, [commit]);

  const undo = useCallback(() => {
    const last = undoStack.current.pop();
    if (!last) return;
    redoStack.current.push(draftRef.current);
    commit(last);
  }, [commit]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(draftRef.current);
    commit(next);
  }, [commit]);

  const reset = useCallback(() => {
    undoStack.current.push(draftRef.current);
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift();
    redoStack.current = [];
    commit(baselineRef.current);
  }, [commit]);

  /** Commit the current draft as the new baseline after a successful save. */
  const markSaved = useCallback(() => {
    baselineRef.current = draftRef.current;
    setBaseline(draftRef.current);
    undoStack.current = [];
    redoStack.current = [];
    commit(draftRef.current);
  }, [commit]);

  /** Only the dirty subset — what a bulk save endpoint should receive. */
  const dirtyPatch = useMemo(() => {
    const patch: SettingsDraft = {};
    for (const key of dirtyFields) {
      patch[key] = draft[key];
    }
    return patch;
  }, [dirtyFields, draft]);

  return {
    draft,
    baseline,
    isDirty,
    dirtyFields,
    dirtyPatch,
    load,
    update,
    updateMany,
    undo,
    redo,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    reset,
    markSaved,
  };
}

export type SettingsDraftApi = ReturnType<typeof useSettingsDraft>;
