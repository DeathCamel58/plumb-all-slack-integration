import { DeepgramClient } from "@deepgram/sdk";
import { Readable } from "stream";
import * as Sentry from "@sentry/node";

const CHANNEL_LABELS = ["Plumber", "Customer"];

/**
 * Transcribes a dual-channel audio buffer using Deepgram.
 * Left channel (0) = Plumber, Right channel (1) = Customer.
 * @param {Buffer} audioBuffer - The audio file buffer (MP3/WAV)
 * @returns {Promise<Array<{speaker: string, text: string, start: number, end: number}>>}
 */
export async function transcribeDualChannel(audioBuffer) {
  try {
    const deepgram = new DeepgramClient({
      apiKey: process.env.DEEPGRAM_API_KEY,
    });

    const stream = Readable.from(audioBuffer);

    const result = await deepgram.listen.v1.media.transcribeFile(stream, {
      model: "nova-3",
      multichannel: true,
      smart_format: true,
    });

    const utterances = [];

    // Each channel is a separate array of alternatives
    const channels = result?.result?.results?.channels ?? [];
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
      const speaker = CHANNEL_LABELS[channelIndex] ?? `Channel ${channelIndex}`;
      const words = channels[channelIndex]?.alternatives?.[0]?.words ?? [];

      if (words.length === 0) continue;

      // Group words into utterances by detecting pauses (>1s gap)
      let currentUtterance = {
        speaker,
        text: words[0].word,
        start: words[0].start,
        end: words[0].end,
      };

      for (let i = 1; i < words.length; i++) {
        if (words[i].start - words[i - 1].end > 1.0) {
          utterances.push(currentUtterance);
          currentUtterance = {
            speaker,
            text: words[i].word,
            start: words[i].start,
            end: words[i].end,
          };
        } else {
          currentUtterance.text += " " + words[i].word;
          currentUtterance.end = words[i].end;
        }
      }
      utterances.push(currentUtterance);
    }

    // Sort by start time so the conversation reads chronologically
    utterances.sort((a, b) => a.start - b.start);

    return utterances;
  } catch (e) {
    Sentry.captureException(e);
    console.error("Deepgram: Error transcribing audio:", e);
    return [];
  }
}
