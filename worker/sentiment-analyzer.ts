export type SentimentResult =
  | {
      happiness: number;
      sadness: number;
      anger: number;
      fear: number;
      surprise: number;
      disgust: number;
      concepts: string[];
    }
  | { error: string | null };

const DEFAULT_SYSTEM_PROMPT = `You are a professional sentiment analyzer. When provided with a message, you will determine sentiment scores and 0-2 key concepts from the message. You will respond in exactly this format:
\`\`\`
happiness:7
sadness:1
anger:0
fear:3
surprise:5
disgust:4
concepts:ukraine war,ukraine ceasefire
\`\`\`
You must respond in english, match the exact formatting in the example with no extra content, and score using whole numbers 0-9 (inclusive).
The concepts included must be concrete "newsworthy topics" such as a specific war, event, person, government action, etc. Not love, peace, friendship, hate, etc.
If the sentiment of the message is unclear, such as a wordle score, a stock price update, an advertisement, a link, etc. your response must be \`\`\`NO SENTIMENT\`\`\``;

export async function analyzeSentiment(
  text: string,
  apiKey: string,
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT
): Promise<SentimentResult> {
  if (!apiKey) {
    return { error: "OPENROUTER_API_KEY not configured" };
  }

  try {
    // console.log(`Analyzing ${text}`);
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/gepeake/WorldHappinessMeter",
          "X-Title": "World Happiness Meter",
        },
        body: JSON.stringify({
          model: "meta-llama/llama-3.1-8b-instruct",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: text },
          ],
        }),
      }
    );

    if (!response.ok) {
      return { error: `OpenRouter API error: ${response.status}` };
    }

    const data = (await response.json()) as any;
    const content = data.choices[0].message.content;

    // Parse the response using regex
    return parseSentimentResponse(content);
  } catch (err) {
    return { error: `Error calling OpenRouter: ${err}` };
  }
}

function parseSentimentResponse(content: string): SentimentResult {
  try {
    const happinessMatch = content.match(/happiness:\s*([\d.]+)/);
    const sadnessMatch = content.match(/sadness:\s*([\d.]+)/);
    const angerMatch = content.match(/anger:\s*([\d.]+)/);
    const fearMatch = content.match(/fear:\s*([\d.]+)/);
    const surpriseMatch = content.match(/surprise:\s*([\d.]+)/);
    const disgustMatch = content.match(/disgust:\s*([\d.]+)/);
    const conceptsMatch = content.match(/concepts:\s*(.*)/);

    if (
      !happinessMatch ||
      !sadnessMatch ||
      !angerMatch ||
      !fearMatch ||
      !surpriseMatch ||
      !disgustMatch ||
      !conceptsMatch
    ) {
      return { error: content };
    }

    const concepts = conceptsMatch[1]
      .trim()
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter(
        (c) =>
          c !== "none" && c !== "unknown" && c !== "n/a" && c !== "na" && c !== "0" && c !== "nil" && c !== "none```"
      )
      .filter((c) => c.length > 1);

    return {
      happiness: parseFloat(happinessMatch[1]),
      sadness: parseFloat(sadnessMatch[1]),
      anger: parseFloat(angerMatch[1]),
      fear: parseFloat(fearMatch[1]),
      surprise: parseFloat(surpriseMatch[1]),
      disgust: parseFloat(disgustMatch[1]),
      concepts,
    };
  } catch (err) {
    console.error("Error parsing sentiment response:", err);
    return { error: String(err) };
  }
}

export { DEFAULT_SYSTEM_PROMPT };
