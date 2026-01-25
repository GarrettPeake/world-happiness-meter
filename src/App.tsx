import { useState, useEffect, useRef, useCallback } from "react";
import { AnimatedWordRenderer, WordCloud } from "@isoterik/react-word-cloud";
import "./App.css";

interface Word {
  text: string;
  value: number;
}

interface SentimentData {
  timestamp: string;
  messageCount: number;
  happinessAvg: number;
  sadnessAvg: number;
  angerAvg: number;
  fearAvg: number;
  surpriseAvg: number;
  disgustAvg: number;
  topConcepts?: { [concept: string]: number };
}

type TimeframeType = "day" | "week" | "month";

const SENTIMENT_TYPES = [
  { key: "happinessAvg" as const, label: "Happiness", color: "#FFD700" },
  { key: "sadnessAvg" as const, label: "Sadness", color: "#4169E1" },
  { key: "angerAvg" as const, label: "Anger", color: "#DC143C" },
  { key: "fearAvg" as const, label: "Fear", color: "#9370DB" },
  { key: "surpriseAvg" as const, label: "Surprise", color: "#FF69B4" },
  { key: "disgustAvg" as const, label: "Disgust", color: "#32CD32" },
];

const TIMEFRAME_MS = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

const NUM_SEGMENTS = 20;

function formatDateRange(start: Date, end: Date): string {
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const startStr = start.toLocaleDateString("en-US", options);
  const endStr = end.toLocaleDateString("en-US", options);

  // If same day, just show the date
  if (startStr === endStr) {
    return startStr;
  }
  return `${startStr} - ${endStr}`;
}

function formatSegmentTime(timestamp: string, timeframe: TimeframeType): string {
  const date = new Date(timestamp);

  if (timeframe === "day") {
    const hours = date.getHours();
    const mins = date.getMinutes();
    const ampm = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${mins.toString().padStart(2, "0")} ${ampm}`;
  } else if (timeframe === "week") {
    const options: Intl.DateTimeFormatOptions = { weekday: "short", hour: "numeric" };
    return date.toLocaleDateString("en-US", options);
  } else {
    const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return date.toLocaleDateString("en-US", options);
  }
}

function App() {
  const [data, setData] = useState<SentimentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [wordCloudLoading, setWordCloudLoading] = useState(false);
  const [wordCloudData, setWordCloudData] = useState<Word[]>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hoveredData, setHoveredData] = useState<SentimentData | null>(null);
  const [timeframe, setTimeframe] = useState<TimeframeType>("day");
  const [offset, setOffset] = useState(0); // 0 = current period, 1 = previous period, etc.
  const wordCloudRef = useRef<HTMLDivElement>(null);
  const [wordCloudDimensions, setWordCloudDimensions] = useState({
    width: 800,
    height: 400,
  });
  const totalWordCount = wordCloudData
    .map((e) => e.value)
    .reduce((a, b) => a + b, 0);

  // Calculate the time range based on timeframe and offset
  const getTimeRange = useCallback(() => {
    const now = new Date();
    const periodMs = TIMEFRAME_MS[timeframe];
    const end = new Date(now.getTime() - offset * periodMs);
    const start = new Date(end.getTime() - periodMs);
    return { start, end };
  }, [timeframe, offset]);

  const handleWordClick = useCallback(
    (word: { text: string; value: number }) => {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(
        word.text
      )}`;
      window.open(searchUrl, "_blank", "noopener,noreferrer");
    },
    []
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    setWordCloudLoading(true);

    try {
      const { start, end } = getTimeRange();
      const segmentMs = (end.getTime() - start.getTime()) / NUM_SEGMENTS;

      // Create fetch promises for all segments in parallel
      const fetchPromises: Promise<SentimentData | null>[] = [];

      for (let i = 0; i < NUM_SEGMENTS; i++) {
        const segmentStart = new Date(start.getTime() + i * segmentMs);
        const segmentEnd = new Date(start.getTime() + (i + 1) * segmentMs);

        const fetchPromise = fetch(
          `/api/meters/?start=${encodeURIComponent(segmentStart.toISOString())}&end=${encodeURIComponent(segmentEnd.toISOString())}`
        )
          .then(async (response) => {
            if (!response.ok) return null;
            return response.json() as Promise<SentimentData>;
          })
          .catch(() => null);

        fetchPromises.push(fetchPromise);
      }

      // Wait for all fetches to complete in parallel
      const results = await Promise.all(fetchPromises);

      // Filter out null results and set data
      const validResults = results.filter((r): r is SentimentData => r !== null);
      setData(validResults);
    } catch (error) {
      console.error("Failed to fetch sentiment data:", error);
    } finally {
      setLoading(false);
      setWordCloudLoading(false);
    }
  }, [getTimeRange]);

  const handleBarHover = (index: number) => {
    setHoveredIndex(index);
    const dataPoint = data[index];
    setHoveredData(dataPoint || null);

    // Set wordcloud data from the topConcepts included in the aggregated data
    if (dataPoint?.topConcepts) {
      const words: Word[] = Object.entries(dataPoint.topConcepts).map(([text, value]) => ({
        text,
        value,
      }));
      setWordCloudData(words);
    } else {
      setWordCloudData([]);
    }
  };

  const handleTimeframeChange = (newTimeframe: TimeframeType) => {
    setTimeframe(newTimeframe);
    setOffset(0); // Reset to current period when changing timeframe
  };

  const handlePrevious = () => {
    setOffset((prev) => prev + 1);
  };

  const handleNext = () => {
    setOffset((prev) => Math.max(0, prev - 1));
  };

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Set initial hover to most recent time period when data loads
  useEffect(() => {
    if (data.length > 0 && hoveredIndex === null) {
      handleBarHover(data.length - 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Calculate word cloud dimensions based on available space
  useEffect(() => {
    const updateDimensions = () => {
      if (wordCloudRef.current) {
        const rect = wordCloudRef.current.getBoundingClientRect();
        setWordCloudDimensions({
          width: rect.width,
          height: rect.height,
        });
      }
    };

    // Use requestAnimationFrame to ensure dimensions are calculated after layout
    const rafId = requestAnimationFrame(() => {
      updateDimensions();
    });

    window.addEventListener("resize", updateDimensions);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", updateDimensions);
    };
  }, []);

  // Recalculate dimensions when data or wordCloudData changes
  useEffect(() => {
    if (wordCloudRef.current) {
      const rect = wordCloudRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setWordCloudDimensions({
          width: rect.width,
          height: rect.height,
        });
      }
    }
  }, [data, wordCloudData]);

  const { start, end } = getTimeRange();

  return (
    <div className="app">
      <header className="header">
        <h1>World Sentiment Meter</h1>
      </header>

      <div className="word-cloud-section" ref={wordCloudRef}>
        <h2 className="word-cloud-header">Trending Topics</h2>
        {wordCloudLoading ? (
          <div className="word-cloud-loading">Loading trends...</div>
        ) : wordCloudData.length > 0 ? (
          <div className="word-cloud-container">
            <WordCloud
              words={wordCloudData}
              width={wordCloudDimensions.width}
              height={wordCloudDimensions.height - 40}
              spiral="rectangular"
              padding={1}
              font="DynaPuff"
              fontSize={(word) =>
                Math.sqrt(
                  (word.value / totalWordCount) * (wordCloudDimensions.height - 40)
                ) * 15
              }
              rotate={() => 0}
              enableTooltip
              onWordClick={handleWordClick}
              renderWord={(data, ref) => (
                <AnimatedWordRenderer
                  ref={ref}
                  data={data}
                  animationDelay={(_word, index) => index * 13}
                />
              )}
            />
          </div>
        ) : (
          <p className="word-cloud-hint">
            Hover over any point on the chart below to see the trends for that
            time period
          </p>
        )}
      </div>

      <div className="chart-section">
        <div className="timeframe-controls">
          <div className="timeframe-display">{formatDateRange(start, end)}</div>
          <div className="timeframe-buttons">
            <button
              className={`timeframe-btn ${timeframe === "day" ? "active" : ""}`}
              onClick={() => handleTimeframeChange("day")}
            >
              Day
            </button>
            <button
              className={`timeframe-btn ${timeframe === "week" ? "active" : ""}`}
              onClick={() => handleTimeframeChange("week")}
            >
              Week
            </button>
            <button
              className={`timeframe-btn ${timeframe === "month" ? "active" : ""}`}
              onClick={() => handleTimeframeChange("month")}
            >
              Month
            </button>
          </div>
          <div className="timeframe-nav">
            <button className="nav-btn" onClick={handlePrevious}>
              &lt;
            </button>
            <button
              className="nav-btn"
              onClick={handleNext}
              disabled={offset === 0}
            >
              &gt;
            </button>
          </div>
        </div>

        <div className="line-chart-container">
          {loading ? (
            <div className="chart-loading">Loading chart data...</div>
          ) : (
            <svg
              className="line-chart"
              viewBox="0 0 1000 400"
              preserveAspectRatio="xMidYMid meet"
            >
              {/* Gridlines */}
              <g className="gridlines">
                {[10, 8.5, 7, 5.5, 4, 2.5, 1].map((value) => {
                  const y = ((10 - value) / 9) * 360 + 20;
                  return (
                    <g key={value}>
                      <line
                        x1="60"
                        y1={y}
                        x2="980"
                        y2={y}
                        stroke="rgba(255, 255, 255, 0.15)"
                        strokeWidth="1"
                      />
                      <text
                        x="45"
                        y={y + 4}
                        fill="rgba(255, 255, 255, 0.5)"
                        fontSize="12"
                        textAnchor="end"
                      >
                        {value}
                      </text>
                    </g>
                  );
                })}
              </g>

              {/* Sentiment lines */}
              {SENTIMENT_TYPES.map((sentiment) => {
                const points = data
                  .map((point, index) => {
                    const x = 60 + (index / Math.max(data.length - 1, 1)) * 920;
                    const normalizedValue = point[sentiment.key] + 1; // Convert from -1..9 to 0..10
                    const y = 380 - (normalizedValue / 10) * 360;
                    return `${x},${y}`;
                  })
                  .join(" ");

                return (
                  <polyline
                    key={sentiment.key}
                    points={points}
                    fill="none"
                    stroke={sentiment.color}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.9"
                  />
                );
              })}

              {/* Data point circles */}
              {SENTIMENT_TYPES.map((sentiment) =>
                data.map((point, index) => {
                  const x = 60 + (index / Math.max(data.length - 1, 1)) * 920;
                  const normalizedValue = point[sentiment.key] + 1;
                  const y = 380 - (normalizedValue / 10) * 360;
                  const isHovered = hoveredIndex === index;

                  return (
                    <circle
                      key={`${sentiment.key}-${index}`}
                      cx={x}
                      cy={y}
                      r={isHovered ? "5" : "3"}
                      fill={sentiment.color}
                      opacity={isHovered ? "1" : "0.7"}
                      style={{ cursor: "pointer", transition: "all 0.2s ease" }}
                      onMouseEnter={() => handleBarHover(index)}
                    />
                  );
                })
              )}

              {/* Hover highlight bar */}
              {hoveredIndex !== null &&
                data.map((_, index) => {
                  if (index !== hoveredIndex) return null;
                  const x = 60 + (index / Math.max(data.length - 1, 1)) * 920;
                  return (
                    <rect
                      key={`highlight-${index}`}
                      x={x - 8}
                      y="10"
                      width="16"
                      height="380"
                      fill="rgba(255, 255, 255, 0.08)"
                      stroke="rgba(255, 255, 255, 0.3)"
                      strokeWidth="2"
                      pointerEvents="none"
                    />
                  );
                })}

              {/* Invisible hover areas for better interaction */}
              {data.map((_, index) => {
                const x = 60 + (index / Math.max(data.length - 1, 1)) * 920;
                return (
                  <rect
                    key={index}
                    x={x - 10}
                    y="20"
                    width="20"
                    height="360"
                    fill="transparent"
                    style={{ cursor: "pointer" }}
                    onMouseEnter={() => handleBarHover(index)}
                  />
                );
              })}

              {/* Legend with values */}
              <g className="legend">
                {SENTIMENT_TYPES.map((sentiment, index) => {
                  const x = 60 + index * 153;
                  const y = 398;
                  const value = hoveredData
                    ? (hoveredData[sentiment.key] + 1).toFixed(2)
                    : "-";
                  const labelStartX = x + 30;
                  return (
                    <g key={sentiment.key}>
                      <line
                        x1={x}
                        y1={y}
                        x2={x + 25}
                        y2={y}
                        stroke={sentiment.color}
                        strokeWidth="3"
                      />
                      <text
                        x={labelStartX}
                        y={y + 6}
                        fill="rgba(255, 255, 255, 0.9)"
                        fontSize="16"
                        fontWeight="500"
                        id={`label-${sentiment.key}`}
                      >
                        {sentiment.label}
                      </text>
                      <text
                        x={labelStartX}
                        y={y + 22}
                        fill="rgba(255, 255, 255, 0.7)"
                        fontSize="16"
                      >
                        {value}
                      </text>
                    </g>
                  );
                })}
              </g>

              {/* X-axis time labels */}
              {data.length > 0 && (
                <g className="x-axis-labels">
                  {/* Start time (leftmost) */}
                  <text
                    x="60"
                    y="10"
                    fill="rgba(255, 255, 255, 0.7)"
                    fontSize="12"
                    textAnchor="start"
                  >
                    {formatSegmentTime(data[0].timestamp, timeframe)}
                  </text>

                  {/* End time (rightmost) */}
                  <text
                    x="980"
                    y="10"
                    fill="rgba(255, 255, 255, 0.7)"
                    fontSize="12"
                    textAnchor="end"
                  >
                    {formatSegmentTime(data[data.length - 1].timestamp, timeframe)}
                  </text>

                  {/* Hovered time (above highlighted section) */}
                  {hoveredIndex !== null &&
                    data.map((point, index) => {
                      if (index !== hoveredIndex) return null;
                      const x = 60 + (index / Math.max(data.length - 1, 1)) * 920;
                      return (
                        <text
                          key={`time-${index}`}
                          x={x}
                          y="5"
                          fill="rgba(255, 255, 255, 0.95)"
                          fontSize="14"
                          fontWeight="600"
                          textAnchor="middle"
                        >
                          {formatSegmentTime(point.timestamp, timeframe)}
                        </text>
                      );
                    })}
                </g>
              )}
            </svg>
          )}
        </div>
      </div>

      {!loading && data.length === 0 && (
        <div className="no-data">
          No sentiment data available for this time period.
        </div>
      )}

      <footer className="footer">
        <a
          href="https://ko-fi.com/garrettpeake"
          target="_blank"
          rel="noopener noreferrer"
          className="kofi-link"
        >
          <img
            src="/kofi.png"
            alt="Support me on Ko-fi"
            className="kofi-image"
          />
        </a>
        <p className="footer-text">
          Samples 1000 posts from the BlueSky Firehose every 5 minutes and uses
          an LLM to perform sentiment analysis and topic extraction, these are
          the results! (Click on a word to search it, sometimes topics are
          NSFW!). Made with love by Garrett Peake
        </p>
      </footer>
    </div>
  );
}

export default App;
