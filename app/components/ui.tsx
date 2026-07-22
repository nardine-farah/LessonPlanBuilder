"use client";

import { ReactNode } from "react";

export function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max?: number;
  help?: string;
  placeholder?: string;
  mono?: boolean;
  error?: string;
}) {
  const over = props.max !== undefined && props.value.length > props.max;
  return (
    <div className={`field${props.error || over ? " invalid" : ""}`}>
      <label className="field-label">
        <span>{props.label}</span>
        {props.max !== undefined && (
          <span className={`field-count${over ? " over" : ""}`}>
            {props.value.length}/{props.max}
          </span>
        )}
      </label>
      <input
        type="text"
        dir="auto"
        className={props.mono ? "mono" : undefined}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.error && <div className="field-error">{props.error}</div>}
      {props.help && !props.error && <div className="field-help">{props.help}</div>}
    </div>
  );
}

export function TextArea(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max?: number;
  help?: string;
  rows?: number;
  error?: string;
}) {
  const over = props.max !== undefined && props.value.length > props.max;
  return (
    <div className={`field${props.error || over ? " invalid" : ""}`}>
      <label className="field-label">
        <span>{props.label}</span>
        {props.max !== undefined && (
          <span className={`field-count${over ? " over" : ""}`}>
            {props.value.length}/{props.max}
          </span>
        )}
      </label>
      <textarea
        dir="auto"
        rows={props.rows ?? 3}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.error && <div className="field-error">{props.error}</div>}
      {props.help && !props.error && <div className="field-help">{props.help}</div>}
    </div>
  );
}

export function ChipGroup(props: {
  label: string;
  options: readonly { value: string; text: string; hint?: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  single?: boolean;
  help?: string;
  error?: string;
}) {
  return (
    <div className="field">
      <label className="field-label">
        <span>{props.label}</span>
      </label>
      <div className="chip-row">
        {props.options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`chip${props.selected.includes(o.value) ? " on" : ""}`}
            title={o.hint}
            onClick={() => props.onToggle(o.value)}
          >
            {o.text}
          </button>
        ))}
      </div>
      {props.error && <div className="field-error">{props.error}</div>}
      {props.help && !props.error && <div className="field-help">{props.help}</div>}
    </div>
  );
}

export function Card(props: { title?: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {props.title && <h2 className="card-title">{props.title}</h2>}
      {props.note && <p className="card-note">{props.note}</p>}
      {props.children}
    </section>
  );
}
