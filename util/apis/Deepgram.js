import fetch from "node-fetch";
import * as Sentry from "@sentry/node";

const CHANNEL_LABELS = ["Plumber", "Customer"];

/**
 * Transcribes a dual-channel audio buffer using the Deepgram REST API directly.
 * Left channel (0) = Plumber, Right channel (1) = Customer.
 * @param {Buffer} audioBuffer - The audio file buffer (MP3/WAV)
 * @returns {Promise<Array<{speaker: string, text: string, start: number, end: number}>>}
 */
export async function transcribeDualChannel(audioBuffer) {
  try {
    console.log(
      `Deepgram: Sending ${audioBuffer.length} byte audio buffer for transcription`,
    );

    const params = new URLSearchParams({
      model: "nova-3",
      multichannel: "true",
      smart_format: "true",
    });

    const response = await fetch(
      `https://api.deepgram.com/v1/listen?${params}`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
          "Content-Type": "audio/mpeg",
        },
        body: audioBuffer,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Deepgram: API returned status ${response.status}: ${errorText}`,
      );
      return [];
    }

    const result = await response.json();

    console.log("Deepgram: Received transcription response");

    const utterances = [];

    // Each channel is a separate array of alternatives
    const channels = result?.results?.channels ?? [];
    console.log(`Deepgram: Response contains ${channels.length} channel(s)`);

    for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
      const speaker = CHANNEL_LABELS[channelIndex] ?? `Channel ${channelIndex}`;
      const words = channels[channelIndex]?.alternatives?.[0]?.words ?? [];
      console.log(
        `Deepgram: Channel ${channelIndex} (${speaker}): ${words.length} word(s)`,
      );

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

    console.log(
      `Deepgram: Transcription complete — ${utterances.length} utterance(s)`,
    );

    return utterances;
  } catch (e) {
    Sentry.captureException(e);
    console.error("Deepgram: Error transcribing audio:", e);
    return [];
  }
}
