type DeepLResponse = {
  translations?: Array<{
    detected_source_language?: string;
    text: string;
  }>;
  message?: string;
  error?: {
    message?: string;
  };
};

type Direction = ReturnType<typeof chooseDirection>;

const MAX_TEXT_CHUNK_LENGTH = 4_000;

export function chooseDirection(text: string) {
  const letterCount = [...text.matchAll(/\p{L}/gu)].length;
  const russianCyrillicCount = [...text.matchAll(/[А-Яа-яЁё]/g)].length;

  if (letterCount === 0) {
    return { sourceLang: undefined, targetLang: "RU" as const, rule: "empty -> auto -> RU" };
  }

  if (russianCyrillicCount / letterCount >= 0.5) {
    return { sourceLang: "RU", targetLang: "EN" as const, rule: ">=50% Russian Cyrillic letters -> RU -> EN" };
  }

  return { sourceLang: undefined, targetLang: "RU" as const, rule: "DeepL auto-detect -> RU" };
}

function splitLongSegment(segment: string) {
  const chunks: string[] = [];
  let remainingText = segment;

  while (remainingText.length > MAX_TEXT_CHUNK_LENGTH) {
    const newlineIndex = remainingText.lastIndexOf("\n", MAX_TEXT_CHUNK_LENGTH);
    const sentenceIndexes = [". ", "! ", "? "]
      .map((separator) => {
        const index = remainingText.lastIndexOf(separator, MAX_TEXT_CHUNK_LENGTH);
        return index === -1 ? -1 : index + separator.length;
      })
      .filter((index) => index !== -1);
    const whitespaceIndex = remainingText.lastIndexOf(" ", MAX_TEXT_CHUNK_LENGTH);
    const splitIndex = Math.max(newlineIndex, ...sentenceIndexes, whitespaceIndex);
    const safeSplitIndex = splitIndex > MAX_TEXT_CHUNK_LENGTH * 0.6 ? splitIndex : MAX_TEXT_CHUNK_LENGTH;

    chunks.push(remainingText.slice(0, safeSplitIndex));
    remainingText = remainingText.slice(safeSplitIndex);
  }

  if (remainingText) {
    chunks.push(remainingText);
  }

  return chunks;
}

function splitTextForDeepL(text: string) {
  return text
    .split(/(\n{2,})/)
    .flatMap((segment) => (segment.length > MAX_TEXT_CHUNK_LENGTH ? splitLongSegment(segment) : [segment]))
    .filter((segment) => segment.length > 0);
}

async function translateChunk(text: string, preferences: Preferences, direction: Direction) {
  const body = new URLSearchParams();
  body.set("text", text);
  body.set("target_lang", direction.targetLang);
  if (direction.sourceLang) {
    body.set("source_lang", direction.sourceLang);
  }

  const response = await fetch(preferences.apiUrl, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${preferences.apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const responseText = await response.text();
  let payload: DeepLResponse;

  try {
    payload = JSON.parse(responseText) as DeepLResponse;
  } catch {
    throw new Error(`DeepL returned an invalid response (${response.status})`);
  }

  if (!response.ok) {
    throw new Error(payload.message || payload.error?.message || `DeepL API error ${response.status}`);
  }

  const translatedText = payload.translations?.[0]?.text;
  if (!translatedText) {
    throw new Error("DeepL response did not contain a translation");
  }

  return {
    translatedText,
    sourceLang: payload.translations?.[0]?.detected_source_language || direction.sourceLang,
  };
}

export async function translate(text: string, preferences: Preferences) {
  const direction = chooseDirection(text);
  const chunks = splitTextForDeepL(text);
  const translatedChunks: string[] = [];
  let detectedSourceLang = direction.sourceLang;

  for (const chunk of chunks) {
    if (!chunk.trim()) {
      translatedChunks.push(chunk);
      continue;
    }

    const translatedChunk = await translateChunk(chunk, preferences, direction);
    translatedChunks.push(translatedChunk.translatedText);
    detectedSourceLang ||= translatedChunk.sourceLang;
  }

  return {
    ...direction,
    translatedText: translatedChunks.join(""),
    sourceLang: detectedSourceLang,
  };
}
