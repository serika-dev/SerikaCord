import { describe, expect, test } from "bun:test";
import { incompleteOnboardingQuestions, normalizeOnboardingConfig } from "../src/lib/servers/onboarding";

describe("incompleteOnboardingQuestions (CORD-68)", () => {
  test("a question with a title but no option is incomplete", () => {
    expect(incompleteOnboardingQuestions([{ title: "What brings you here?", options: [] }])).toEqual([0]);
  });

  test("options without titles don't count", () => {
    expect(incompleteOnboardingQuestions([{ title: "Pick one", options: [{ title: "  " }] }])).toEqual([0]);
  });

  test("an option without a question title is incomplete", () => {
    expect(incompleteOnboardingQuestions([{ title: "", options: [{ title: "Gaming" }] }])).toEqual([0]);
  });

  test("complete and completely blank questions pass", () => {
    const questions = [
      { title: "Pick one", options: [{ title: "Gaming" }] },
      { title: "", description: "", options: [{ title: "", description: "" }] },
      { title: "Half done", options: [] },
    ];
    expect(incompleteOnboardingQuestions(questions)).toEqual([2]);
  });

  test("whatever passes the check survives normalization", () => {
    const questions = [{ id: "q1", title: "Pick one", options: [{ id: "o1", title: "Gaming" }] }];
    expect(incompleteOnboardingQuestions(questions)).toEqual([]);
    expect(normalizeOnboardingConfig({ enabled: true, questions }).questions).toHaveLength(1);
  });

  test("non-arrays are ignored", () => {
    expect(incompleteOnboardingQuestions(undefined)).toEqual([]);
    expect(incompleteOnboardingQuestions("x")).toEqual([]);
  });
});
