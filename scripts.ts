import * as fs from "fs/promises";
import * as dotenv from "dotenv";
import { connectToFirehose, FirehosePost } from "./worker/firehose-client";
import {
  analyzeSentiment,
  DEFAULT_SYSTEM_PROMPT,
} from "./worker/sentiment-analyzer";

// Load environment variables
dotenv.config();

interface SentimentScores {
  happiness: number;
  sadness: number;
  anger: number;
  fear: number;
  surprise: number;
  disgust: number;
}

interface ConceptCounts {
  [concept: string]: number;
}

interface CorpusEntry {
  text: string;
  did: string;
  timestamp: number;
}

// SENTIMIZE: Run sentiment analysis on live firehose for 1 minute
async function sentimize() {
  console.log("Starting sentiment analysis - will run for 1 minute");
  console.log("============================================\n");

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY not configured in .env file");
    return;
  }

  let messageCount = 0;
  const sentimentSums: SentimentScores = {
    happiness: 0,
    sadness: 0,
    anger: 0,
    fear: 0,
    surprise: 0,
    disgust: 0,
  };
  const conceptCounts: ConceptCounts = {};

  await connectToFirehose({
    durationMs: 60 * 1000, // 1 minute
    onPost: async (post: FirehosePost) => {
      console.log(`\nProcessing message ${messageCount + 1}:`);
      console.log(
        `Text: ${post.text.substring(0, 100)}${
          post.text.length > 100 ? "..." : ""
        }`
      );

      const result = await analyzeSentiment(post.text, apiKey);

      if (!("error" in result)) {
        messageCount++;

        console.log(
          `Sentiment: H:${result.happiness.toFixed(
            1
          )} S:${result.sadness.toFixed(1)} A:${result.anger.toFixed(
            1
          )} F:${result.fear.toFixed(1)} Su:${result.surprise.toFixed(
            1
          )} D:${result.disgust.toFixed(1)}`
        );
        console.log(`Concepts: ${result.concepts.join(", ")}`);

        // Add to sums
        sentimentSums.happiness += result.happiness;
        sentimentSums.sadness += result.sadness;
        sentimentSums.anger += result.anger;
        sentimentSums.fear += result.fear;
        sentimentSums.surprise += result.surprise;
        sentimentSums.disgust += result.disgust;

        // Count concepts
        for (const concept of result.concepts) {
          const lowerConcept = concept.toLowerCase();
          conceptCounts[lowerConcept] = (conceptCounts[lowerConcept] || 0) + 1;
        }
      } else {
        console.log(result.error);
      }
    },
    onError: (error) => {
      console.error("Error:", error);
    },
  });

  // Display results
  console.log("\n============================================");
  console.log("FINAL RESULTS");
  console.log("============================================\n");

  if (messageCount > 0) {
    console.log(`Total messages analyzed: ${messageCount}`);
    console.log("\nAverage Sentiment Scores:");
    console.log(
      `  Happiness: ${(sentimentSums.happiness / messageCount).toFixed(2)}`
    );
    console.log(
      `  Sadness: ${(sentimentSums.sadness / messageCount).toFixed(2)}`
    );
    console.log(`  Anger: ${(sentimentSums.anger / messageCount).toFixed(2)}`);
    console.log(`  Fear: ${(sentimentSums.fear / messageCount).toFixed(2)}`);
    console.log(
      `  Surprise: ${(sentimentSums.surprise / messageCount).toFixed(2)}`
    );
    console.log(
      `  Disgust: ${(sentimentSums.disgust / messageCount).toFixed(2)}`
    );

    const sortedConcepts = Object.entries(conceptCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    console.log("\nTop 20 Concepts:");
    for (const [concept, count] of sortedConcepts) {
      console.log(`  ${concept}: ${count}`);
    }
  } else {
    console.log("No messages were processed");
  }

  console.log("\n============================================");
}

// CORPUS: Collect sample posts from firehose
async function corpus() {
  const targetCount = parseInt(process.argv[3] || "100");
  console.log(`Collecting ${targetCount} posts from firehose...`);
  console.log("============================================\n");

  const posts: CorpusEntry[] = [];
  let collected = 0;

  await connectToFirehose({
    durationMs: targetCount * 100,
    onPost: async (post: FirehosePost) => {
      if (collected >= targetCount) {
        return;
      }

      posts.push({
        text: post.text,
        did: post.did,
        timestamp: Date.now(),
      });

      collected++;
      console.log(
        `Collected ${collected}/${targetCount}: ${post.text.substring(
          0,
          60
        )}...`
      );
    },
    onError: (error) => {
      console.error("Error:", error);
    },
  });

  // Save to file
  const filename = `corpus_${Date.now()}.json`;
  await fs.writeFile(filename, JSON.stringify(posts, null, 2));

  console.log(`\n✓ Saved ${posts.length} posts to ${filename}`);
}

// VALIDATE: Test sentiment analysis on a corpus file
async function validate() {
  const filename = process.argv[3];
  if (!filename) {
    console.error("Usage: npm run validate <corpus-file.json>");
    console.error("Optional: Add custom prompt as additional argument");
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY not configured in .env file");
    return;
  }

  // Load custom prompt if provided
  const customPrompt = process.argv[4];
  const systemPrompt = customPrompt || DEFAULT_SYSTEM_PROMPT;

  if (customPrompt) {
    console.log("Using custom prompt:");
    console.log(customPrompt);
    console.log();
  } else {
    console.log("Using default prompt");
    console.log();
  }

  // Load corpus
  const content = await fs.readFile(filename, "utf-8");
  const corpus: CorpusEntry[] = JSON.parse(content);

  console.log(`Analyzing ${corpus.length} posts from corpus...`);
  console.log("============================================\n");

  let processed = 0;
  const sentimentSums: SentimentScores = {
    happiness: 0,
    sadness: 0,
    anger: 0,
    fear: 0,
    surprise: 0,
    disgust: 0,
  };
  const conceptCounts: ConceptCounts = {};

  await Promise.all(
    corpus.map(async (entry) => {
      return await analyzeSentiment(entry.text, apiKey, systemPrompt).then(
        (result) => {
          if (!("error" in result)) {
            processed++;

            // Add to sums
            sentimentSums.happiness += result.happiness;
            sentimentSums.sadness += result.sadness;
            sentimentSums.anger += result.anger;
            sentimentSums.fear += result.fear;
            sentimentSums.surprise += result.surprise;
            sentimentSums.disgust += result.disgust;

            // Count concepts
            for (const concept of result.concepts) {
              const lowerConcept = concept.toLowerCase();
              conceptCounts[lowerConcept] =
                (conceptCounts[lowerConcept] || 0) + 1;
            }
          } else {
            if (result.error === "NO SENTIMENT") {
              processed++;
            }
            console.log(
              `\n${result.error} -> [${processed + 1}/${
                corpus.length
              }] ${entry.text.trim().replaceAll("\n", "\\ ").substring(0, 200)}`
            );
          }
        }
      );
    })
  );

  // Display results
  console.log("\n============================================");
  console.log("VALIDATION RESULTS");
  console.log("============================================\n");

  console.log(`Successfully processed: ${processed}/${corpus.length}`);
  console.log("\nAverage Sentiment Scores:");
  console.log(
    `  Happiness: ${(sentimentSums.happiness / processed).toFixed(2)}`
  );
  console.log(`  Sadness: ${(sentimentSums.sadness / processed).toFixed(2)}`);
  console.log(`  Anger: ${(sentimentSums.anger / processed).toFixed(2)}`);
  console.log(`  Fear: ${(sentimentSums.fear / processed).toFixed(2)}`);
  console.log(`  Surprise: ${(sentimentSums.surprise / processed).toFixed(2)}`);
  console.log(`  Disgust: ${(sentimentSums.disgust / processed).toFixed(2)}`);

  const sortedConcepts = Object.entries(conceptCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  console.log("\nTop 20 Concepts:");
  for (const [concept, count] of sortedConcepts) {
    console.log(`  ${concept}: ${count}`);
  }

  console.log("\n============================================");
}

// Main router
const command = process.argv[2];

switch (command) {
  case "sentimize":
    sentimize().catch(console.error);
    break;
  case "corpus":
    corpus().catch(console.error);
    break;
  case "validate":
    validate().catch(console.error);
    break;
  default:
    console.error("Usage:");
    console.error(
      "  npm run sentimize              - Analyze live firehose for 1 minute"
    );
    console.error(
      "  npm run corpus [count]         - Collect posts (default: 100)"
    );
    console.error("  npm run validate <file.json>   - Test prompt on corpus");
    process.exit(1);
}
