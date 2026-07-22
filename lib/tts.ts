import { createHash } from "crypto";
import { GoogleAuth } from "google-auth-library";
import path from "path";

/**
 * Text-to-Speech for reflection narration. Google Cloud TTS is called with
 * OAuth from the service account / Application Default Credentials (no API
 * key needed) unless an explicit key is configured.
 *
 * Naturalness setup (2026-07-16): Studio-class voice for English, SSML with
 * sentence-aware pauses, speakingRate 0.92, headphone effects profile. Arabic
 * has no Studio voice, so it keeps Wavenet but gets the same SSML pacing.
 *
 * Provider order: TTS_PROVIDER override → GOOGLE_TTS_API_KEY → OPENAI_API_KEY
 * → Google TTS via service-account OAuth.
 */

export interface TtsResult {
  mp3: Buffer;
  durationSec: number;
}

export class TtsError extends Error {}

const SPEAKING_RATE = Number(process.env.TTS_SPEAKING_RATE ?? 0.92);
const EFFECTS_PROFILE = ["headphone-class-device"];
/** Pause lengths (ms): lead-in, between sentences, trailing settle. */
const BREAK_LEAD = 300;
const BREAK_BETWEEN = 550;
const BREAK_TRAIL = 400;

function voiceFor(language: "en" | "ar"): string {
  if (language === "ar") return process.env.TTS_VOICE_AR ?? "ar-XA-Wavenet-B";
  return process.env.TTS_VOICE ?? process.env.TTS_VOICE_EN ?? "en-US-Studio-O";
}

/**
 * Fingerprint of everything that changes how narration SOUNDS. Baked into the
 * uploaded MP3's filename so a republish re-renders audio when the voice
 * setup changes, instead of reusing stale recordings.
 */
export function audioSignature(language: "en" | "ar"): string {
  const config = JSON.stringify({
    v: 2, // bump when the SSML shaping itself changes
    voice: voiceFor(language),
    rate: SPEAKING_RATE,
    effects: EFFECTS_PROFILE,
    provider: process.env.TTS_PROVIDER ?? (process.env.OPENAI_API_KEY && !process.env.GOOGLE_TTS_API_KEY ? "openai" : "google"),
  });
  return createHash("sha1").update(config).digest("hex").slice(0, 8);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Sentence splitter that also understands Arabic terminators. */
function splitSentences(text: string): string[] {
  const sentences = text
    .trim()
    .split(/(?<=[.!?؟۔])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.length ? sentences : [text.trim()];
}

/** Plain narration text → paced SSML: lead-in pause, sentence breaks, trailing settle. */
export function toSsml(text: string): string {
  const sentences = splitSentences(text);
  const body = sentences
    .map(
      (s, i) =>
        escapeXml(s) +
        (i < sentences.length - 1
          ? `<break time='${BREAK_BETWEEN}ms'/>`
          : `<break time='${BREAK_TRAIL}ms'/>`),
    )
    .join(" ");
  return `<speak><break time='${BREAK_LEAD}ms'/>${body}</speak>`;
}

/** Estimated playback seconds: ~150 wpm scaled by speaking rate, plus the inserted pauses. */
export function estimateDurationSec(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const sentences = splitSentences(text).length;
  const speechSec = (words / 150) * 60 / SPEAKING_RATE;
  const breakSec = (BREAK_LEAD + BREAK_TRAIL + BREAK_BETWEEN * Math.max(0, sentences - 1)) / 1000;
  return Math.max(2, Math.round(speechSec + breakSec));
}

let cachedAuth: GoogleAuth | null = null;

function googleAuth(): GoogleAuth {
  if (cachedAuth) return cachedAuth;
  const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  cachedAuth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    ...(saPath
      ? { keyFilename: path.isAbsolute(saPath) ? saPath : path.join(process.cwd(), saPath) }
      : {}),
  });
  return cachedAuth;
}

async function googleTts(text: string, language: "en" | "ar"): Promise<Buffer> {
  const voice = voiceFor(language);
  const apiKey = process.env.GOOGLE_TTS_API_KEY;

  let url = "https://texttospeech.googleapis.com/v1/text:synthesize";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    url += `?key=${apiKey}`;
  } else {
    const token = await googleAuth().getAccessToken();
    if (!token) throw new TtsError("Couldn't obtain a Google access token from the service account.");
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      input: { ssml: toSsml(text) },
      voice: { languageCode: voice.slice(0, 5), name: voice },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: SPEAKING_RATE,
        effectsProfileId: EFFECTS_PROFILE,
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    if (res.status === 403 && detail.includes("SERVICE_DISABLED")) {
      throw new TtsError(
        "The Cloud Text-to-Speech API isn't enabled on this Firebase project yet — enable it once at console.cloud.google.com → APIs & Services → Text-to-Speech API, then republish.",
      );
    }
    throw new TtsError(`Google TTS ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { audioContent?: string };
  if (!data.audioContent) throw new TtsError("Google TTS returned no audio");
  return Buffer.from(data.audioContent, "base64");
}

async function openaiTts(text: string): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new TtsError("OPENAI_API_KEY not set");
  const voice = process.env.TTS_VOICE ?? "alloy";
  const model = process.env.TTS_MODEL ?? "gpt-4o-mini-tts";
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, voice, input: text, response_format: "mp3" }),
  });
  if (!res.ok) throw new TtsError(`OpenAI TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Synthesize narration MP3 for a reflection script. */
export async function synthesize(text: string, language: "en" | "ar"): Promise<TtsResult> {
  const explicit = process.env.TTS_PROVIDER;
  const provider =
    explicit === "google" || explicit === "openai"
      ? explicit
      : process.env.GOOGLE_TTS_API_KEY
        ? "google"
        : process.env.OPENAI_API_KEY
          ? "openai"
          : "google"; // service-account OAuth path
  const mp3 = provider === "google" ? await googleTts(text, language) : await openaiTts(text);
  return { mp3, durationSec: estimateDurationSec(text) };
}
