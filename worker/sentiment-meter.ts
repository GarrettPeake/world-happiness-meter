import { connectToFirehose, type FirehosePost } from "./firehose-client";
import { analyzeSentiment } from "./sentiment-analyzer";

export interface SentimentData {
  timestamp: string; // ISO8601 format
  messageCount: number;
  happinessAvg: number;
  sadnessAvg: number;
  angerAvg: number;
  fearAvg: number;
  surpriseAvg: number;
  disgustAvg: number;
  topConcepts: { [concept: string]: number };
}

export async function updateMeters(
  apiKey: string
): Promise<SentimentData | null> {
  console.log("Starting updateMeters");

  // Phase 1: Collection - buffer all posts without analysis
  const collectedPosts: FirehosePost[] = [];

  await connectToFirehose({
    eventLimit: 1000, // Workers can only do 1000 sub requests and the websocket itself uses some
    onPost: async (post: FirehosePost) => {
      collectedPosts.push(post);
    },
    onError: (error) => {
      console.error("Firehose error:", error);
    },
  });

  console.log(`Collected ${collectedPosts.length} posts from firehose`);

  // Phase 2: Analysis - process all posts in parallel
  let messageCount = 0;
  let failureCount = 0;
  let noSentimentCount = 0;
  const sentimentSums = {
    happiness: 0,
    sadness: 0,
    anger: 0,
    fear: 0,
    surprise: 0,
    disgust: 0,
  };
  const conceptCounts: { [concept: string]: number } = {};

  // Process all posts in parallel
  const results = await Promise.all(
    collectedPosts.map((post) => analyzeSentiment(post.text, apiKey))
  );

  // Aggregate results
  for (const result of results) {
    if (!("error" in result)) {
      messageCount++;

      // Add to sentiment sums
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
      if (result.error !== "NO SENTIMENT") {
        failureCount++;
      } else {
        noSentimentCount++;
      }
    }
  }

  // Return results
  if (messageCount > 0) {
    // Calculate averages
    const avgSentiments = {
      happiness: sentimentSums.happiness / messageCount,
      sadness: sentimentSums.sadness / messageCount,
      anger: sentimentSums.anger / messageCount,
      fear: sentimentSums.fear / messageCount,
      surprise: sentimentSums.surprise / messageCount,
      disgust: sentimentSums.disgust / messageCount,
    };

    // Get top 200 concepts
    const sortedConcepts = Object.entries(conceptCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 200);

    const top200Concepts: { [concept: string]: number } = {};
    for (const [concept, count] of sortedConcepts) {
      top200Concepts[concept] = count;
    }

    const timestamp = new Date().toISOString();

    console.log(
      `Collected sentiment data: ${messageCount} messages analyzed (${failureCount} unable to process, ${noSentimentCount} no sentiment)`
    );

    return {
      timestamp,
      messageCount,
      happinessAvg: avgSentiments.happiness,
      sadnessAvg: avgSentiments.sadness,
      angerAvg: avgSentiments.anger,
      fearAvg: avgSentiments.fear,
      surpriseAvg: avgSentiments.surprise,
      disgustAvg: avgSentiments.disgust,
      topConcepts: top200Concepts,
    };
  } else {
    console.log("No messages processed");
    return null;
  }
}

// Generate hour prefixes for a time range
export function generateHourPrefixes(start: Date, end: Date): string[] {
  const prefixes: string[] = [];

  // Round start down to hour, end up to hour
  start.setMinutes(0, 0, 0);
  end.setMinutes(0, 0, 0);

  const current = new Date(start);
  while (current <= end) {
    // Format: "2025-01-03T17" (up to the hour)
    const prefix = current.toISOString().substring(0, 13);
    prefixes.push(prefix);

    // Move to next hour
    current.setHours(current.getHours() + 1);
  }

  return prefixes;
}

// Retrieve historical data for a time range
export async function getHistoricalMeters(
  kv: KVNamespace,
  start: Date,
  end: Date,
  includeTopConcepts = false
): Promise<SentimentData[]> {
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const prefixes = generateHourPrefixes(start, end);
  const results: SentimentData[] = [];
  const keysToFetch: string[] = [];

  for (const prefix of prefixes) {
    let cursor: string | undefined = undefined;
    let hasMore = true;

    while (hasMore) {
      const listResult: KVNamespaceListResult<SentimentData, string> =
        await kv.list({
          prefix,
          cursor,
        });

      // Filter by exact time range and extract from metadata
      for (const key of listResult.keys) {
        if (key.name >= startIso && key.name <= endIso && key.metadata) {
          results.push({
            ...key.metadata,
            timestamp: key.name,
          } as SentimentData);
          if (includeTopConcepts) {
            keysToFetch.push(key.name);
          }
        }
      }
      hasMore = !listResult.list_complete;
      if (!listResult.list_complete) {
        cursor = listResult.cursor;
      }
    }
  }

  // Fetch topConcepts for each key if requested
  if (includeTopConcepts && keysToFetch.length > 0) {
    const conceptPromises = keysToFetch.map((key) => kv.get(key));
    const conceptResults = await Promise.all(conceptPromises);

    for (let i = 0; i < results.length; i++) {
      const conceptJson = conceptResults[i];
      if (conceptJson) {
        results[i].topConcepts = JSON.parse(conceptJson);
      }
    }
  }

  // Sort by timestamp
  results.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return results;
}

// Aggregate multiple SentimentData entries into a single aggregated result
export function aggregateSentimentData(
  dataPoints: SentimentData[],
  start: Date,
  end: Date
): SentimentData | null {
  if (dataPoints.length === 0) {
    return null;
  }

  let totalMessageCount = 0;
  const sentimentSums = {
    happiness: 0,
    sadness: 0,
    anger: 0,
    fear: 0,
    surprise: 0,
    disgust: 0,
  };
  const conceptCounts: { [concept: string]: number } = {};

  for (const data of dataPoints) {
    totalMessageCount += data.messageCount;

    // Weight sentiment averages by message count
    sentimentSums.happiness += data.happinessAvg * data.messageCount;
    sentimentSums.sadness += data.sadnessAvg * data.messageCount;
    sentimentSums.anger += data.angerAvg * data.messageCount;
    sentimentSums.fear += data.fearAvg * data.messageCount;
    sentimentSums.surprise += data.surpriseAvg * data.messageCount;
    sentimentSums.disgust += data.disgustAvg * data.messageCount;

    // Aggregate concepts
    if (data.topConcepts) {
      for (const [concept, count] of Object.entries(data.topConcepts)) {
        conceptCounts[concept] = (conceptCounts[concept] || 0) + count;
      }
    }
  }

  // Calculate weighted averages
  const avgSentiments = {
    happiness: sentimentSums.happiness / totalMessageCount,
    sadness: sentimentSums.sadness / totalMessageCount,
    anger: sentimentSums.anger / totalMessageCount,
    fear: sentimentSums.fear / totalMessageCount,
    surprise: sentimentSums.surprise / totalMessageCount,
    disgust: sentimentSums.disgust / totalMessageCount,
  };

  // Get top 200 concepts
  const sortedConcepts = Object.entries(conceptCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 200);

  const top200Concepts: { [concept: string]: number } = {};
  for (const [concept, count] of sortedConcepts) {
    top200Concepts[concept] = count;
  }

  // Use the midpoint of the range as the timestamp
  const midpoint = new Date((start.getTime() + end.getTime()) / 2);

  return {
    timestamp: midpoint.toISOString(),
    messageCount: totalMessageCount,
    happinessAvg: avgSentiments.happiness,
    sadnessAvg: avgSentiments.sadness,
    angerAvg: avgSentiments.anger,
    fearAvg: avgSentiments.fear,
    surpriseAvg: avgSentiments.surprise,
    disgustAvg: avgSentiments.disgust,
    topConcepts: top200Concepts,
  };
}

// Retrieve aggregated data for a time range
export async function getAggregatedMeters(
  kv: KVNamespace,
  start: Date,
  end: Date
): Promise<SentimentData | null> {
  // Include topConcepts so they can be aggregated
  const dataPoints = await getHistoricalMeters(kv, start, end, true);
  return aggregateSentimentData(dataPoints, start, end);
}
