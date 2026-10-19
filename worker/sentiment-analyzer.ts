export type SentimentResult =
  | {
      happiness: number;
      sadness: number;
      anger: number;
      fear: number;
      surprise: number;
      disgust: number;
    }
  | { error: string | null };

const EMOTIONS = [
  "happiness",
  "sadness",
  "anger",
  "fear",
  "surprise",
  "disgust",
] as const;

const OPENROUTER_HEADERS = {
  "Content-Type": "application/json",
  "HTTP-Referer": "https://github.com/gepeake/WorldHappinessMeter",
  "X-Title": "World Happiness Meter",
};

// Decider noul questions: each answer is the probability (0-1) that "true" holds
const SENTIMENT_QUESTIONS = Object.fromEntries(
  EMOTIONS.map((emotion) => [
    emotion,
    {
      type: "noul",
      instructions: emotion,
      criteria: { true: `expresses ${emotion}`, false: "does not" },
    },
  ])
);

export const RATE_LIMITED = "RATE LIMITED";

const CONCEPT_MODEL = "deepseek/deepseek-v4.1-flash";
export const CONCEPT_BATCH_SIZE = 50;

const DEFAULT_CONCEPT_PROMPT = `Each input line is "<n>:<post>". For posts about a concrete newsworthy topic (a specific war, event, person, government action, etc. Not love, peace, friendship, hate, etc.), output up to 2 topics per post as "<n>:<topic>". Topics must be 1-3 english words, translated if needed, and broad enough to recur across many posts (e.g. "gaza" not "mohammad injured in gaza"). If a post has no clear topic, output nothing for it, never a placeholder like "no topic" or "none". If no post has one, return an empty list.`;

export async function analyzeSentiment(
  text: string,
  apiKey: string
): Promise<SentimentResult> {
  if (!apiKey) {
    return { error: "OPENROUTER_API_KEY not configured" };
  }
  // Image-only posts have no text, and the model scores empty input as highly emotional
  if (!text.trim()) {
    return { error: "NO SENTIMENT" };
  }

  try {
    const response = await fetch("https://openrouter.ai/api/alpha/decisions", {
      method: "POST",
      headers: { ...OPENROUTER_HEADERS, Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "perplexity/pplx-decider-flash-v1.2",
        state: text,
        questions: SENTIMENT_QUESTIONS,
      }),
    });

    if (response.status === 429) {
      return { error: RATE_LIMITED };
    }
    if (!response.ok) {
      return { error: `OpenRouter API error: ${response.status}` };
    }

    const data = (await response.json()) as {
      answers: { [question: string]: { noul: number } };
    };
    const answers = data.answers;

    if (EMOTIONS.every((emotion) => answers[emotion].noul < 0.5)) {
      return { error: "NO SENTIMENT" };
    }

    // Scale the probability of "true" to the existing 0-10 meter range
    const scores = Object.fromEntries(
      EMOTIONS.map((emotion) => [emotion, answers[emotion].noul * 10])
    ) as { [K in (typeof EMOTIONS)[number]]: number };

    return scores;
  } catch (err) {
    return { error: `Error calling OpenRouter: ${err}` };
  }
}

// Returns up to 2 concepts per input text, in the same order as texts
export async function extractConcepts(
  texts: string[],
  apiKey: string,
  systemPrompt: string = DEFAULT_CONCEPT_PROMPT
): Promise<string[][]> {
  const concepts: string[][] = texts.map(() => []);
  if (!apiKey) {
    return concepts;
  }

  const batches: number[] = [];
  for (let start = 0; start < texts.length; start += CONCEPT_BATCH_SIZE) {
    batches.push(start);
  }

  await Promise.all(
    batches.map(async (start) => {
      const batch = texts.slice(start, start + CONCEPT_BATCH_SIZE);
      try {
        const lines = await extractConceptBatch(batch, apiKey, systemPrompt);
        for (const line of lines) {
          const separator = line.indexOf(":");
          const index = parseInt(line.substring(0, separator));
          const concept = line
            .substring(separator + 1)
            .trim()
            .toLowerCase();
          const postConcepts = concepts[start + index];
          if (
            !postConcepts ||
            index >= batch.length ||
            concept.length <= 1 ||
            postConcepts.length >= 2 ||
            postConcepts.includes(concept)
          ) {
            continue;
          }
          postConcepts.push(concept);
        }
      } catch (err) {
        console.error("Error extracting concepts:", err);
      }
    })
  );

  return concepts;
}

async function extractConceptBatch(
  texts: string[],
  apiKey: string,
  systemPrompt: string
): Promise<string[]> {
  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: { ...OPENROUTER_HEADERS, Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: CONCEPT_MODEL,
        reasoning: { enabled: false },
        provider: { require_parameters: true, sort: "price" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: texts
              .map((text, i) => `${i}:${text.replace(/\s+/g, " ").trim()}`)
              .join("\n"),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "t",
            strict: true,
            schema: {
              type: "object",
              properties: { t: { type: "array", items: { type: "string" } } },
              required: ["t"],
              additionalProperties: false,
            },
          },
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices: { message: { content: string } }[];
  };
  return (JSON.parse(data.choices[0].message.content) as { t: string[] }).t;
}

export { DEFAULT_CONCEPT_PROMPT };
