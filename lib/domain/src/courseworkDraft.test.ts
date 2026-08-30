import { describe, expect, it } from "vitest";
import {
  validateDraft,
  validateQuestions,
  draftSystemPrompt,
  draftUserPrompt,
  questionsSystemPrompt,
  replaceQuestionUserPrompt,
  moreQuestionsUserPrompt,
  clampWanted,
  roomForMoreQuestions,
  originFor,
  resolveOrigin,
  describeDraftRun,
  MIN_DRAFT_QUESTIONS,
  MAX_OPTIONS_PER_QUESTION,
  MAX_QUIZ_QUESTIONS,
  MAX_EXPAND_AT_ONCE,
} from "./courseworkDraft";
import { DEFAULT_RUBRIC, DEFAULT_REVIEWS_REQUIRED } from "./reviews";

// Distinct prompts by default: identical questions are now dropped as
// duplicates, which is the point, so a fixture that repeats itself would be
// testing the deduplicator rather than whatever the test is about.
let nextQuestion = 0;
function question(overrides: Record<string, unknown> = {}) {
  nextQuestion += 1;
  return {
    prompt: `What does a power purchase agreement fix, part ${nextQuestion}?`,
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

  it("requires answers to be settled by the material given", () => {
    expect(draftSystemPrompt()).toMatch(/settled by the material you were given/);
  });

  it("tells the drafter to prefer the transcript over the slides", () => {
    // Slides are headings. The class is where the reasoning happens.
    expect(draftSystemPrompt()).toMatch(/prefer it/);
  });

  it("includes the class context and the material in the request", () => {
    const user = draftUserPrompt({
      programTitle: "Strategic Energy Communications",
      sessionTitle: "Rewrite for radio",
      sessionDescription: "Turning a written brief into spoken word",
      sourceText: "--- Slide 1 ---\nRadio is heard once.",
    });
    expect(user).toContain("Strategic Energy Communications");
    expect(user).toContain("Rewrite for radio");
    expect(user).toContain("Radio is heard once.");
  });

  it("omits the description line when there is none", () => {
    const user = draftUserPrompt({
      programTitle: "P", sessionTitle: "S", sessionDescription: "", sourceText: "text",
    });
    expect(user).not.toContain("What the facilitator says");
  });
});

describe("MIN_DRAFT_QUESTIONS", () => {
  it("asks for enough questions to be a real check", () => {
    expect(MIN_DRAFT_QUESTIONS).toBeGreaterThanOrEqual(3);
  });
});

const ctx = {
  programTitle: "Strategic Energy Communications",
  sessionTitle: "Reading a tariff order",
  sessionDescription: "",
  sourceText: "=== TRANSCRIPT ===\n\nThe order raised the band A tariff.",
};

describe("validateQuestions — refusing to repeat the quiz", () => {
  it("drops a question that restates one already on the quiz", () => {
    // The failure mode of "give me four more": four rephrasings of question two.
    const { questions, problems } = validateQuestions(
      [question({ prompt: "What does a Power Purchase Agreement fix?" })],
      { existingPrompts: ["What does a power purchase agreement fix?"] },
    );
    expect(questions).toHaveLength(0);
    expect(problems.join(" ")).toMatch(/asks what the quiz already asks/);
  });

  it("ignores punctuation and case when deciding two questions are the same", () => {
    const { questions } = validateQuestions(
      [question({ prompt: "WHAT  does a power-purchase agreement fix???" })],
      { existingPrompts: ["What does a power purchase agreement fix?"] },
    );
    expect(questions).toHaveLength(0);
  });

  it("keeps a question about genuinely different ground", () => {
    const { questions, problems } = validateQuestions(
      [question({ prompt: "Who approves a tariff order in Nigeria?" })],
      { existingPrompts: ["What does a power purchase agreement fix?"] },
    );
    expect(questions).toHaveLength(1);
    expect(problems).toEqual([]);
  });

  it("catches duplicates inside a single batch too", () => {
    const twice = "Which body approves a tariff order?";
    const { questions } = validateQuestions([question({ prompt: twice }), question({ prompt: twice })]);
    expect(questions).toHaveLength(1);
  });

  it("applies the same checks as a first draft", () => {
    const { questions, problems } = validateQuestions([question({ correctIndex: 9 })]);
    expect(questions).toHaveLength(0);
    expect(problems.join(" ")).toMatch(/valid correct answer/);
  });

  it("copes with a non-array", () => {
    expect(validateQuestions(null).questions).toEqual([]);
    expect(validateQuestions("nope").questions).toEqual([]);
  });
});

describe("asking for a replacement question", () => {
  const existing = [
    { prompt: "What does a PPA fix?", options: ["Price", "Colour", "Weather"] },
    { prompt: "Who signs it?", options: ["Offtaker", "Regulator", "Press"] },
  ];

  it("names the question being replaced rather than leaving a gap", () => {
    const p = replaceQuestionUserPrompt({ ...ctx, existing, replaceIndex: 1 });
    expect(p).toContain("Replace question 2");
    expect(p).toContain("Who signs it?");
  });

  it("shows the other questions so the replacement does not duplicate them", () => {
    const p = replaceQuestionUserPrompt({ ...ctx, existing, replaceIndex: 1 });
    expect(p).toContain("What does a PPA fix?");
    expect(p).toMatch(/must not repeat/);
  });

  it("passes the facilitator's own steer through", () => {
    const p = replaceQuestionUserPrompt({
      ...ctx, existing, replaceIndex: 0, guidance: "make it about who pays, not what it costs",
    });
    expect(p).toContain("make it about who pays");
  });

  it("copes with an index that no longer exists", () => {
    const p = replaceQuestionUserPrompt({ ...ctx, existing, replaceIndex: 7 });
    expect(p).toContain("Write one new question");
  });

  it("includes the class material", () => {
    expect(replaceQuestionUserPrompt({ ...ctx, existing, replaceIndex: 0 }))
      .toContain("The order raised the band A tariff.");
  });
});

describe("asking for more questions", () => {
  const existing = [{ prompt: "What does a PPA fix?", options: ["Price", "Colour", "Weather"] }];

  it("asks for the number wanted, in plain words", () => {
    expect(moreQuestionsUserPrompt({ ...ctx, existing, wanted: 3 })).toContain("Write 3 further questions");
    expect(moreQuestionsUserPrompt({ ...ctx, existing, wanted: 1 })).toContain("Write 1 further question");
  });

  it("insists the new ones cover untouched ground", () => {
    expect(moreQuestionsUserPrompt({ ...ctx, existing, wanted: 2 }))
      .toMatch(/covering material the questions above do not/);
  });

  it("says plainly when the quiz is empty", () => {
    expect(moreQuestionsUserPrompt({ ...ctx, existing: [], wanted: 2 }))
      .toContain("The quiz is currently empty.");
  });
});

describe("clampWanted", () => {
  it("keeps a sensible ask as it is", () => {
    expect(clampWanted(3, 2)).toBe(3);
  });

  it("never asks for more than a handful at once", () => {
    expect(clampWanted(50, 0)).toBe(MAX_EXPAND_AT_ONCE);
  });

  it("will not push the quiz past the ceiling", () => {
    expect(clampWanted(4, MAX_QUIZ_QUESTIONS - 2)).toBe(2);
  });

  it("never returns zero or a negative", () => {
    expect(clampWanted(0, 0)).toBe(1);
    expect(clampWanted(-3, 0)).toBe(1);
  });
});

describe("roomForMoreQuestions", () => {
  it("reports what is left", () => {
    expect(roomForMoreQuestions(MAX_QUIZ_QUESTIONS - 3)).toBe(3);
  });

  it("reports none once the quiz is full", () => {
    expect(roomForMoreQuestions(MAX_QUIZ_QUESTIONS)).toBe(0);
    expect(roomForMoreQuestions(MAX_QUIZ_QUESTIONS + 5)).toBe(0);
  });
});

describe("originFor", () => {
  const seed = { prompt: "What does a PPA fix?", options: ["Price", "Colour", "Weather"], correctIndex: 0 };

  it("calls a question with no draft behind it hand-written", () => {
    expect(originFor(seed, undefined)).toBe("manual");
    expect(originFor(seed, null)).toBe("manual");
  });

  it("calls an untouched draft question drafted", () => {
    expect(originFor({ ...seed }, seed)).toBe("drafted");
  });

  it("ignores whitespace the editor may have added", () => {
    expect(originFor({ ...seed, prompt: "  What does a PPA fix?  " }, seed)).toBe("drafted");
  });

  it("notices a reworded prompt", () => {
    expect(originFor({ ...seed, prompt: "What does a PPA actually fix?" }, seed)).toBe("edited");
  });

  it("notices a changed answer key — the change that matters most", () => {
    expect(originFor({ ...seed, correctIndex: 1 }, seed)).toBe("edited");
  });

  it("notices a rewritten option", () => {
    expect(originFor({ ...seed, options: ["Price per unit", "Colour", "Weather"] }, seed)).toBe("edited");
  });

  it("notices an added or removed option", () => {
    expect(originFor({ ...seed, options: ["Price", "Colour"] }, seed)).toBe("edited");
  });
});

describe("resolveOrigin", () => {
  it("trusts the comparison with a draft made in this sitting", () => {
    expect(resolveOrigin({ againstDraft: "drafted" })).toBe("drafted");
    expect(resolveOrigin({ againstDraft: "edited", savedOrigin: "manual" })).toBe("edited");
  });

  it("calls something with no history at all hand-written", () => {
    expect(resolveOrigin({})).toBe("manual");
    expect(resolveOrigin({ againstDraft: null, savedOrigin: null })).toBe("manual");
  });

  it("keeps what the database recorded when nothing has changed since", () => {
    // The bug this prevents: reopening a module the next morning and pressing
    // save would otherwise claim a person wrote what the model wrote.
    expect(resolveOrigin({ savedOrigin: "drafted", unchangedSinceSaved: true })).toBe("drafted");
    expect(resolveOrigin({ savedOrigin: "edited", unchangedSinceSaved: true })).toBe("edited");
    expect(resolveOrigin({ savedOrigin: "manual", unchangedSinceSaved: true })).toBe("manual");
  });

  it("marks a drafted item edited once someone changes it later", () => {
    expect(resolveOrigin({ savedOrigin: "drafted", unchangedSinceSaved: false })).toBe("edited");
    expect(resolveOrigin({ savedOrigin: "edited", unchangedSinceSaved: false })).toBe("edited");
  });

  it("leaves a hand-written item hand-written however often it is reworded", () => {
    expect(resolveOrigin({ savedOrigin: "manual", unchangedSinceSaved: false })).toBe("manual");
  });
});

describe("describeDraftRun", () => {
  it("says what it was made from, when, and by whom", () => {
    const line = describeDraftRun({
      kinds: ["slides", "notes"],
      notesLabel: "Transcript",
      questionCount: 5,
      byName: "Amina",
      at: new Date("2026-08-12T09:00:00Z"),
    });
    expect(line).toContain("5 questions drafted from the slides and the transcript");
    expect(line).toContain("12 August 2026");
    expect(line).toContain("by Amina");
  });

  it("reads correctly for a single question", () => {
    expect(describeDraftRun({ kinds: ["slides"], questionCount: 1, at: new Date("2026-08-12T09:00:00Z") }))
      .toContain("1 question drafted from the slides");
  });

  it("leaves out the name when nobody is recorded", () => {
    const line = describeDraftRun({ kinds: ["notes"], questionCount: 2, at: "2026-08-12T09:00:00Z" });
    expect(line).not.toContain("by ");
  });

  it("survives an unparseable date rather than printing Invalid Date", () => {
    const line = describeDraftRun({ kinds: ["slides"], questionCount: 2, at: "not a date" });
    expect(line).not.toMatch(/Invalid/);
    expect(line).toContain("2 questions drafted from the slides");
  });
});

describe("the brief for redoing and expanding", () => {
  it("carries the same energy-terminology rules as a first draft", () => {
    expect(questionsSystemPrompt()).toMatch(/Capacity is not generation/);
  });

  it("forbids restating an existing question", () => {
    expect(questionsSystemPrompt()).toMatch(/must not restate a question already on the quiz/);
  });

  it("does not ask for a written task", () => {
    expect(questionsSystemPrompt()).toMatch(/Do\s+not write a task/);
  });
});
