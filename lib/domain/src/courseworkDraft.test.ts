import { describe, expect, it } from "vitest";
import {
  validateDraft,
  draftSystemPrompt,
  draftUserPrompt,
  MIN_DRAFT_QUESTIONS,
  MAX_OPTIONS_PER_QUESTION,
} from "./courseworkDraft";
import { DEFAULT_RUBRIC, DEFAULT_REVIEWS_REQUIRED } from "./reviews";

function question(overrides: Record<string, unknown> = {}) {
  return {
    prompt: "What does a power purchase agreement fix?",
    options: ["The price paid per unit", "The colour of the pylons", "The weather", "The staff rota"],
    correctIndex: 0,
    rationale: "The slides define a PPA as a long-term price contract.",
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    questions: [question(), question(), question()],
    assignment: {
      title: "Write a 200-word lede on the subsidy removal",
      instructions: "You are filing for a national daily...",
    },
    notes: [],
    ...overrides,
  };
}

describe("validateDraft — a good draft", () => {
  it("passes a well-formed draft through", () => {
    const { draft, problems } = validateDraft(payload());
    expect(problems).toEqual([]);
    expect(draft!.questions).toHaveLength(3);
    expect(draft!.assignment.title).toMatch(/lede/);
  });

  it("always uses the house rubric, never one the model invented", () => {
    const { draft } = validateDraft(payload({
      assignment: {
        title: "T",
        instructions: "I",
        rubric: [{ id: "vibes", label: "Vibes", description: "", maxScore: 10 }],
        reviewsRequired: 99,
      },
    }));
    expect(draft!.assignment.rubric).toEqual(DEFAULT_RUBRIC);
    expect(draft!.assignment.reviewsRequired).toBe(DEFAULT_REVIEWS_REQUIRED);
  });

  it("keeps the rationale for the facilitator to check the key against", () => {
    const { draft } = validateDraft(payload());
    expect(draft!.questions[0].rationale).toContain("PPA");
  });
});

describe("validateDraft — catching bad questions", () => {
  it("drops a question whose correct answer is out of range", () => {
    const { draft, problems } = validateDraft(payload({
      questions: [question(), question(), question({ correctIndex: 9 })],
    }));
    expect(draft!.questions).toHaveLength(2);
    expect(problems.join(" ")).toMatch(/valid correct answer/);
  });

  it("drops a question with no correct answer marked at all", () => {
    const { draft } = validateDraft(payload({
      questions: [question(), question(), question({ correctIndex: undefined })],
    }));
    expect(draft!.questions).toHaveLength(2);
  });

  it("drops a question with too few options", () => {
    const { draft, problems } = validateDraft(payload({
      questions: [question(), question(), question({ options: ["Only one"] })],
    }));
    expect(draft!.questions).toHaveLength(2);
    expect(problems.join(" ")).toMatch(/fewer than/);
  });

  it("drops a question that repeats an answer", () => {
    const { draft, problems } = validateDraft(payload({
      questions: [question(), question(), question({ options: ["Same", "Same", "Different"] })],
    }));
    expect(draft!.questions).toHaveLength(2);
    expect(problems.join(" ")).toMatch(/repeated an answer/);
  });

  it("drops an empty question", () => {
    const { draft } = validateDraft(payload({
      questions: [question(), question(), question({ prompt: "   " })],
    }));
    expect(draft!.questions).toHaveLength(2);
  });

  it("trims a question that came back with too many options", () => {
    const { draft } = validateDraft(payload({
      questions: [question({ options: ["a", "b", "c", "d", "e", "f"], correctIndex: 1 })],
    }));
    expect(draft!.questions[0].options).toHaveLength(MAX_OPTIONS_PER_QUESTION);
  });

  it("warns when too few questions survive", () => {
    const { problems } = validateDraft(payload({ questions: [question()] }));
    expect(problems.join(" ")).toMatch(new RegExp(`Only 1 question`));
  });

  it("ignores blank options rather than counting them", () => {
    const { draft } = validateDraft(payload({
      questions: [question({ options: ["Real", "  ", "Also real", "Third"], correctIndex: 0 })],
    }));
    expect(draft!.questions[0].options).toEqual(["Real", "Also real", "Third"]);
  });
});

describe("validateDraft — catching a bad task", () => {
  it("says so when the task came back incomplete", () => {
    const { draft, problems } = validateDraft(payload({ assignment: { title: "", instructions: "" } }));
    expect(problems.join(" ")).toMatch(/came back incomplete/);
    expect(draft!.assignment.title).toBe("");
  });

  it("still returns the quiz when only the task failed", () => {
    const { draft } = validateDraft(payload({ assignment: {} }));
    expect(draft!.questions).toHaveLength(3);
  });
});

describe("validateDraft — nothing usable", () => {
  it("returns null for a non-object", () => {
    expect(validateDraft("nope").draft).toBeNull();
    expect(validateDraft(null).draft).toBeNull();
  });

  it("returns null when neither the quiz nor the task survived", () => {
    const { draft, problems } = validateDraft({ questions: [], assignment: {}, notes: [] });
    expect(draft).toBeNull();
    expect(problems.join(" ")).toMatch(/Nothing usable/);
  });

  it("copes with questions that are not objects", () => {
    const { draft } = validateDraft(payload({ questions: ["a string", 42, question()] }));
    expect(draft!.questions).toHaveLength(1);
  });
});

describe("the brief given to the drafter", () => {
  it("names the energy-terminology traps explicitly", () => {
    const prompt = draftSystemPrompt();
    expect(prompt).toMatch(/Capacity is not generation/);
    expect(prompt).toMatch(/megawatt-hours/);
  });

  it("insists the task cannot be done without the class", () => {
    expect(draftSystemPrompt()).toMatch(/impossible to complete well without having attended/);
  });

  it("requires answers to be settled by the slides", () => {
    expect(draftSystemPrompt()).toMatch(/settled by the slides/);
  });

  it("includes the class context and the slides in the request", () => {
    const user = draftUserPrompt({
      programTitle: "Strategic Energy Communications",
      sessionTitle: "Rewrite for radio",
      sessionDescription: "Turning a written brief into spoken word",
      slideText: "--- Slide 1 ---\nRadio is heard once.",
    });
    expect(user).toContain("Strategic Energy Communications");
    expect(user).toContain("Rewrite for radio");
    expect(user).toContain("Radio is heard once.");
  });

  it("omits the description line when there is none", () => {
    const user = draftUserPrompt({
      programTitle: "P", sessionTitle: "S", sessionDescription: "", slideText: "text",
    });
    expect(user).not.toContain("What the facilitator says");
  });
});

describe("MIN_DRAFT_QUESTIONS", () => {
  it("asks for enough questions to be a real check", () => {
    expect(MIN_DRAFT_QUESTIONS).toBeGreaterThanOrEqual(3);
  });
});
