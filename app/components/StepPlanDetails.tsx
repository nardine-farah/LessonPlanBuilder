"use client";

import type { Draft } from "@/lib/types";
import { Card, TextArea, TextField } from "./ui";

export default function StepPlanDetails(props: {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
}) {
  const { draft, update } = props;

  return (
    <>
      {draft.sourceNotes && (
        <div className="notice notice-info">
          <strong>Notes from the analysis of “{draft.sourceFileName}”</strong>
          {draft.detectedLanguage && <> (source language: {draft.detectedLanguage})</>}:{" "}
          {draft.sourceNotes}
        </div>
      )}

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
              onChange={(e) => update({ language: e.target.value as "en" | "ar" })}
            >
              <option value="en">English (en)</option>
              <option value="ar">Arabic (ar)</option>
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
            help="The Bible translation the runtime fetches, e.g. NIV (English) or NAV (Arabic)."
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
