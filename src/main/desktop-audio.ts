import * as fs from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { runHermesPythonJson } from "./desktop-python";

const VOICEBOX_DEFAULT_URL = "http://127.0.0.1:17493";
const VOICEBOX_DEFAULT_PROFILE = "80M Desktop Buddy";
const VOICEBOX_DEFAULT_CLIENT_ID = "80m-desktop-buddy";

type VoiceboxSpeakResponse = {
  id?: string;
  status?: string;
  error?: string | null;
};

type VoiceboxGenerationStatus = {
  id?: string;
  status?: string;
  error?: string | null;
};

export function writeFloatWav(filePath: string, samples: number[]): void {
  const numSamples = samples.length;
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = numSamples * 2;
  const fileSize = 36 + dataSize;

  const wavHeader = Buffer.alloc(44);
  wavHeader.write("RIFF", 0);
  wavHeader.writeUInt32LE(fileSize, 4);
  wavHeader.write("WAVE", 8);
  wavHeader.write("fmt ", 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20);
  wavHeader.writeUInt16LE(numChannels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(bitsPerSample, 34);
  wavHeader.write("data", 36);
  wavHeader.writeUInt32LE(dataSize, 40);

  const audioBuf = Buffer.alloc(numSamples * 2);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, Number(samples[i]) || 0));
    audioBuf.writeInt16LE(Math.round(s * 32767), i * 2);
  }

  fs.writeFileSync(filePath, Buffer.concat([wavHeader, audioBuf]));
}

export function audioExtensionFromMime(mimeType: string): string {
  if (/ogg/i.test(mimeType)) return ".ogg";
  if (/wav/i.test(mimeType)) return ".wav";
  if (/mpeg|mp3/i.test(mimeType)) return ".mp3";
  if (/mp4|m4a/i.test(mimeType)) return ".m4a";
  return ".webm";
}

export async function transcribeAudioFile(filePath: string): Promise<string> {
  const script = String.raw`
import json
import sys
from tools.transcription_tools import transcribe_audio

result = transcribe_audio(sys.argv[1])
print(json.dumps(result, ensure_ascii=False))
`;
  const result = await runHermesPythonJson(script, [filePath], 180000);
  if (result.success && typeof result.transcript === "string") {
    return result.transcript.trim();
  }
  return "";
}

function voiceboxUrl(): string {
  return (process.env.VOICEBOX_URL || VOICEBOX_DEFAULT_URL).replace(/\/+$/, "");
}

function voiceboxProfile(): string {
  return process.env.VOICEBOX_PROFILE || VOICEBOX_DEFAULT_PROFILE;
}

function voiceboxClientId(): string {
  return process.env.VOICEBOX_CLIENT_ID || VOICEBOX_DEFAULT_CLIENT_ID;
}

function voiceboxTimeoutMs(envName: string, fallback: number): number {
  const parsed = Number(process.env[envName]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function parseVoiceboxStatus(streamText: string): VoiceboxGenerationStatus {
  let latest: VoiceboxGenerationStatus = {};
  for (const line of streamText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    try {
      latest = JSON.parse(trimmed.slice(5).trim());
    } catch {
      // Ignore malformed progress frames and keep the last valid status.
    }
  }
  return latest;
}

async function synthesizeVoiceboxSpeech(text: string): Promise<string> {
  if (process.env.VOICEBOX_DISABLED === "1") return "";

  const baseUrl = voiceboxUrl();
  const profile = voiceboxProfile();
  const outputPath = join(
    tmpdir(),
    "80m-voice",
    `voicebox_${Date.now()}_${Math.random().toString(16).slice(2)}.wav`,
  );
  fs.mkdirSync(dirname(outputPath), { recursive: true });

  const speakResponse = await fetchWithTimeout(
    `${baseUrl}/speak`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Voicebox-Client-Id": voiceboxClientId(),
      },
      body: JSON.stringify({
        text,
        profile,
        engine: process.env.VOICEBOX_ENGINE || "kokoro",
        language: "en",
        personality: false,
      }),
    },
    voiceboxTimeoutMs("VOICEBOX_SPEAK_TIMEOUT_MS", 8000),
  );

  if (!speakResponse.ok) {
    throw new Error(`Voicebox speak failed (${speakResponse.status})`);
  }

  const generation = (await speakResponse.json()) as VoiceboxSpeakResponse;
  if (!generation.id) {
    throw new Error("Voicebox did not return a generation id");
  }

  const statusResponse = await fetchWithTimeout(
    `${baseUrl}/generate/${generation.id}/status`,
    { headers: { Accept: "text/event-stream" } },
    voiceboxTimeoutMs("VOICEBOX_GENERATION_TIMEOUT_MS", 90000),
  );

  if (!statusResponse.ok) {
    throw new Error(`Voicebox status failed (${statusResponse.status})`);
  }

  const status = parseVoiceboxStatus(await statusResponse.text());
  if (status.status !== "completed") {
    throw new Error(status.error || `Voicebox generation ${status.status}`);
  }

  const audioResponse = await fetchWithTimeout(
    `${baseUrl}/audio/${generation.id}`,
    { headers: { Accept: "audio/wav" } },
    voiceboxTimeoutMs("VOICEBOX_AUDIO_TIMEOUT_MS", 15000),
  );

  if (!audioResponse.ok) {
    throw new Error(`Voicebox audio failed (${audioResponse.status})`);
  }

  const audioBytes = Buffer.from(await audioResponse.arrayBuffer());
  if (audioBytes.length <= 44) {
    throw new Error("Voicebox returned empty audio");
  }

  fs.writeFileSync(outputPath, audioBytes);
  return outputPath;
}

export async function synthesizeSpeech(text: string): Promise<string> {
  try {
    const voiceboxPath = await synthesizeVoiceboxSpeech(text);
    if (voiceboxPath) return voiceboxPath;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `[VOICEBOX] Buddy voice unavailable; speech skipped because fallback voices are disabled: ${reason}`,
    );
  }
  return "";
}
