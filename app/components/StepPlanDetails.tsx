"use client";

import type { Draft } from "@/lib/types";
import { LANGUAGES, LANGUAGE_INFO, coerceLanguage, defaultTranslation } from "@/lib/languages";
import { Card, TextArea, TextField } from "./ui";

export default function StepPlanDetails(props: {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
}) {
  const { draft, update } = props;

  return (
    <>
      {/* The analysis notes live with the linked source PDF on step 1 — one place, not two. */}
      <Card
        title="How the plan appears in the library"
        note="These fields drive the recommendation card leaders see in the Studio. Everything was proposed from the PDF — edit freely."
      >
        <div className="grid-2">
          <TextField
            label="Title"
            value={draft.title}
            onChange={(v) => update({ title: v })}
            max={80}
            placeholder="Fear"
          />
          <TextField
            label="Subtitle"
            value={draft.subtitle}
            onChange={(v) => update({ subtitle: v })}
            max={120}
            placeholder="Devotional · Judges 6-8 (Gideon)"
          />
        </div>
        <TextArea
          label="Summary"
          value={draft.summary}
          onChange={(v) => update({ summary: v })}
          max={280}
          rows={2}
          help="One or two sentences; shown on the recommendation card and plan home."
        />
        <div className="grid-2">
          <TextField
            label="Span"
            value={draft.span}
            onChange={(v) => update({ span: v })}
            max={80}
            placeholder="5 sessions · about 1 week"
            help="A human label for the plan's length."
          />
          <TextField
            label="Plan ID (slug)"
            value={draft.planId}
            onChange={(v) => update({ planId: v.toLowerCase() })}
            mono
            help="Lowercase letters, digits, hyphens (3–60). Also the file name: data/lesson-plans/{planId}.json"
          />
        </div>
      </Card>

      <Card title="Language & provenance">
        <div className="grid-2">
          <div className="field">
            <label className="field-label">
              <span>Plan language</span>
            </label>
            <select
              value={draft.language}
              onChange={(e) => {
                const next = coerceLanguage(e.target.value);
                // The translation follows the language unless the curator
                // typed a custom one.
                const custom =
                  draft.translation.trim() !== "" && draft.translation !== defaultTranslation(draft.language);
                update({ language: next, translation: custom ? draft.translation : defaultTranslation(next) });
              }}
            >
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {LANGUAGE_INFO[l].name} ({l})
                </option>
              ))}
            </select>
            <div className="field-help">
              Must match the language the content is actually written in.
            </div>
          </div>
          <TextField
            label="Translation"
            value={draft.translation}
            onChange={(v) => update({ translation: v })}
            max={40}
            help={`The Bible translation the runtime fetches, e.g. ${LANGUAGES.map((l) => `${LANGUAGE_INFO[l].translation} (${LANGUAGE_INFO[l].name})`).join(", ")}.`}
          />
        </div>
        <TextField
          label="Reviewed by / provenance"
          value={draft.reviewedBy}
          onChange={(v) => update({ reviewedBy: v })}
          max={120}
          help='Where the material came from and who reviews it, e.g. "Adapted from Hope for the Heart — reviewed 2026-07".'
        />
      </Card>
    </>
  );
}
