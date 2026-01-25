import { updateMeters, getHistoricalMeters, getAggregatedMeters } from "./sentiment-meter";

interface Env {
  SENTIMENT_DATA: KVNamespace;
  OPENROUTER_API_KEY: string;
}

async function refreshMeters(env: Env, ctx: ExecutionContext): Promise<void> {
  // Run the meter update
  ctx.waitUntil(
    (async () => {
      const data = await updateMeters(env.OPENROUTER_API_KEY);

      if (data) {
        const { timestamp, topConcepts, ...sentiments } = data;
        // Store in KV with ISO timestamp as key and sentiments in metadata and concepts as the value for lazy retrieval
        await env.SENTIMENT_DATA.put(timestamp, JSON.stringify(topConcepts), {
          metadata: sentiments,
        });

        console.log(`Stored sentiment data at ${data.timestamp}`);
      }
    })()
  );
}

export default {
  async scheduled(
    _: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    console.log("Cron triggered - starting sentiment analysis");
    refreshMeters(env, ctx);
  },

  async fetch(
    request: Request,
    env: Env,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _: ExecutionContext
  ): Promise<Response> {
    const route = new URL(request.url).pathname;
    try {
      if (route.startsWith("/api/meters")) {
        const url = new URL(request.url);
        const startParam = url.searchParams.get("start");
        const endParam = url.searchParams.get("end");

        // If start and end are provided, return aggregated data for that range
        if (startParam && endParam) {
          const start = new Date(startParam);
          const end = new Date(endParam);

          if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return new Response(
              JSON.stringify({ error: "Invalid date format" }),
              {
                status: 400,
                headers: {
                  "Content-Type": "application/json",
                  "Access-Control-Allow-Origin": "*",
                },
              }
            );
          }

          const aggregatedData = await getAggregatedMeters(
            env.SENTIMENT_DATA,
            start,
            end
          );

          if (!aggregatedData) {
            return new Response(
              JSON.stringify({ error: "No data found for time range" }),
              {
                status: 404,
                headers: {
                  "Content-Type": "application/json",
                  "Access-Control-Allow-Origin": "*",
                },
              }
            );
          }

          return new Response(JSON.stringify(aggregatedData, null, 2), {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          });
        }

        // Default: Calculate time range for past 24 hours
        const end = new Date();
        const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);

        // Get historical data
        const historicalData = await getHistoricalMeters(
          env.SENTIMENT_DATA,
          start,
          end
        );

        return new Response(JSON.stringify(historicalData, null, 2), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } else if (route.startsWith("/api/concepts")) {
        // Get timestamp from query parameter
        const url = new URL(request.url);
        const timestamp = url.searchParams.get("timestamp");

        if (!timestamp) {
          return new Response(
            JSON.stringify({ error: "Missing timestamp parameter" }),
            {
              status: 400,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            }
          );
        }

        // Fetch the topConcepts from KV (stored as value at timestamp key)
        const topConceptsJson = await env.SENTIMENT_DATA.get(timestamp);

        if (!topConceptsJson) {
          return new Response(
            JSON.stringify({ error: "No data found for timestamp" }),
            {
              status: 404,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            }
          );
        }

        const topConcepts = JSON.parse(topConceptsJson);

        return new Response(JSON.stringify(topConcepts, null, 2), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } else {
        // Return a 404 to fall through to the frontend
        return new Response(null, { status: 404 });
      }
    } catch (error) {
      console.error("Uncaught exception:", error);
      return new Response(JSON.stringify({ error: "Uncaught exception" }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  },
} satisfies ExportedHandler<Env>;
