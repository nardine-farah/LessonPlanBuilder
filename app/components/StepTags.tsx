"use client";

import type { Draft } from "@/lib/types";
import { Card, ChipGroup } from "./ui";

const FAITH_LEVELS = [
  { value: "scholars", text: "Scholars", hint: "Deep study, trained readers" },
  { value: "believers", text: "Believers", hint: "Established Christians" },
  { value: "seekers", text: "Seekers", hint: "Exploring, not yet committed" },
  { value: "new_to_faith", text: "New to faith", hint: "Recently converted" },
] as const;

const AUDIENCES = [
  { value: "women", text: "Women" },
  { value: "kids", text: "Kids" },
  { value: "teens", text: "Teens" },
  { value: "adults", text: "Adults" },
  { value: "pastors", text: "Pastors & leaders" },
] as const;

const FOCUSES = [
  { value: "discipleship", text: "Discipleship" },
  { value: "trauma_healing", text: "Trauma healing" },
  { value: "bible_study", text: "Bible study" },
  { value: "devotional", text: "Devotional" },
] as const;

const LENGTH_BANDS = [
  { value: "short", text: "Short · ≈5" },
  { value: "full", text: "Full · ≈8" },
  { value: "season", text: "Season · ≈10–12" },
  { value: "open", text: "Open" },
] as const;

const RESOURCES = [
  { value: "reading", text: "Reading" },
  { value: "audio", text: "Audio", hint: "Scripture audio + TTS reflection narration" },
  { value: "video", text: "Video", hint: "Only if a real teaching video exists (v1: poster only)" },
  { value: "printable", text: "Printable" },
] as const;

export default function StepTags(props: {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
}) {
  const { draft, update } = props;
  const m = draft.match;

  const toggle = (key: "faithLevel" | "audience" | "focus" | "resources", value: string) => {
    const list = m[key];
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    update({ match: { ...m, [key]: next } });
  };

  const suggestedBand =
    draft.lessons.length <= 6 ? "short" : draft.lessons.length <= 9 ? "full" : draft.lessons.length <= 13 ? "season" : "open";

  return (
    <>
      <Card
        title="Who is this plan for?"
        note="These tags decide which builder interviews surface the plan. Pick every tag that genuinely applies — faith level, audience, and focus carry the most weight in matching (0.25 each)."
      >
        <ChipGroup
          label="Faith level"
          options={FAITH_LEVELS}
          selected={m.faithLevel}
          onToggle={(v) => toggle("faithLevel", v)}
          help="Who is this written for, spiritually?"
          error={m.faithLevel.length === 0 ? "Pick at least one." : undefined}
        />
        <hr className="divider" />
        <ChipGroup
          label="Audience"
          options={AUDIENCES}
          selected={m.audience}
          onToggle={(v) => toggle("audience", v)}
          help="The life-stage or group the material suits."
          error={m.audience.length === 0 ? "Pick at least one." : undefined}
        />
        <hr className="divider" />
        <ChipGroup
          label="Focus"
          options={FOCUSES}
          selected={m.focus}
          onToggle={(v) => toggle("focus", v)}
          help="The thematic heart of the plan."
          error={m.focus.length === 0 ? "Pick at least one." : undefined}
        />
      </Card>

      <Card title="Shape & delivery">
        <ChipGroup
          label="Length band"
          options={LENGTH_BANDS}
          selected={m.lengthBand ? [m.lengthBand] : []}
          onToggle={(v) => update({ match: { ...m, lengthBand: v } })}
          help={`This plan has ${draft.lessons.length} lesson${draft.lessons.length === 1 ? "" : "s"} — “${suggestedBand}” is the matching band.`}
          error={!m.lengthBand ? "Pick one." : undefined}
        />
        <hr className="divider" />
        <ChipGroup
          label="Resources"
          options={RESOURCES}
          selected={m.resources}
          onToggle={(v) => toggle("resources", v)}
          help="Only list what the plan can actually deliver. Don't list video if there is no video."
          error={m.resources.length === 0 ? "Pick at least one." : undefined}
        />
        {m.resources.includes("audio") && (
          <div className="notice notice-info" style={{ marginTop: 14, marginBottom: 0 }}>
            Audio selected — each lesson gets <code>scriptureAudio</code>, and any{" "}
            <em>reflection script</em> you keep in the next step can be rendered to MP3 in
            Scripture Studio with <code>npm run tts:render</code>.
          </div>
        )}
      </Card>
    </>
  );
}
