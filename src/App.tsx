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

const SENTIMENT_TYPES = [
  { key: "happinessAvg" as const, label: "Happiness", color: "#FFD700" },
  { key: "sadnessAvg" as const, label: "Sadness", color: "#4169E1" },
  { key: "angerAvg" as const, label: "Anger", color: "#DC143C" },
  { key: "fearAvg" as const, label: "Fear", color: "#9370DB" },
  { key: "surpriseAvg" as const, label: "Surprise", color: "#FF69B4" },
  { key: "disgustAvg" as const, label: "Disgust", color: "#32CD32" },
];

function App() {
  const [data, setData] = useState<SentimentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [wordCloudData, setWordCloudData] = useState<Word[]>([]);
  const [hoveredTimestamp, setHoveredTimestamp] = useState<string | null>(null);
  const [hoveredData, setHoveredData] = useState<SentimentData | null>(null);
  const conceptFetchTimeout = useRef<number | null>(null);
  const wordCloudRef = useRef<HTMLDivElement>(null);
  const [wordCloudDimensions, setWordCloudDimensions] = useState({
    width: 800,
    height: 400,
  });
  const totalWordCount = wordCloudData
    .map((e) => e.value)
    .reduce((a, b) => a + b, 0);

  const formatTimeToNearest5Min = (timestamp: string) => {
    const date = new Date(timestamp);
    const minutes = date.getMinutes();
    const roundedMinutes = Math.round(minutes / 5) * 5;
    date.setMinutes(roundedMinutes);
    date.setSeconds(0);
    date.setMilliseconds(0);

    const hours = date.getHours();
    const mins = date.getMinutes();
    const ampm = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 || 12;

    return `${displayHours}:${mins.toString().padStart(2, "0")} ${ampm}`;
  };

  const handleWordClick = useCallback(
    (word: { text: string; value: number }) => {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(
        word.text
      )}`;
      window.open(searchUrl, "_blank", "noopener,noreferrer");
    },
    []
  );

  const fetchData = async () => {
    try {
      const response = await fetch("/api/meters/");
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error("Failed to fetch sentiment data:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchConcepts = async (timestamp: string) => {
    try {
      const response = await fetch(
        `/api/concepts?timestamp=${encodeURIComponent(timestamp)}`
      );
      if (!response.ok) {
        console.error("Failed to fetch concepts:", response.statusText);
        return;
      }
      const concepts: { [concept: string]: number } = await response.json();

      // Convert concepts object to Word array for WordCloud
      const words: Word[] = Object.entries(concepts).map(([text, value]) => ({
        text,
        value,
      }));

      setWordCloudData(words);
    } catch (error) {
      console.error("Failed to fetch concepts:", error);
      setWordCloudData([]);
    }
  };

  const handleBarHover = (timestamp: string) => {
    // Update visual state immediately
    setHoveredTimestamp(timestamp);
    const dataPoint = data.find((d) => d.timestamp === timestamp);
    setHoveredData(dataPoint || null);

    // Debounce the concept fetch to avoid too many API calls
    if (conceptFetchTimeout.current) {
      clearTimeout(conceptFetchTimeout.current);
    }
    conceptFetchTimeout.current = window.setTimeout(() => {
      fetchConcepts(timestamp);
    }, 150);
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Set initial hover to most recent time period when data loads
  useEffect(() => {
    if (data.length > 0 && !hoveredTimestamp) {
      const mostRecent = data[data.length - 1];
      handleBarHover(mostRecent.timestamp);
    }
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

  if (loading) {
    return (
      <div className="app">
        <div className="loading">Loading sentiment data...</div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <h1>World Happiness Meter</h1>
      </header>

      <div className="word-cloud-section" ref={wordCloudRef}>
        {wordCloudData.length > 0 ? (
          <div className="word-cloud-container">
            <WordCloud
              words={wordCloudData}
              width={wordCloudDimensions.width}
              height={wordCloudDimensions.height}
              spiral="rectangular"
              padding={1}
              font="DynaPuff"
              fontSize={(word) =>
                Math.sqrt(
                  (word.value / totalWordCount) * wordCloudDimensions.height
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

      <div className="line-chart-container">
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
              const isHovered = hoveredTimestamp === point.timestamp;

              return (
                <circle
                  key={`${sentiment.key}-${point.timestamp}`}
                  cx={x}
                  cy={y}
                  r={isHovered ? "5" : "3"}
                  fill={sentiment.color}
                  opacity={isHovered ? "1" : "0.7"}
                  style={{ cursor: "pointer", transition: "all 0.2s ease" }}
                  onMouseEnter={() => handleBarHover(point.timestamp)}
                />
              );
            })
          )}

          {/* Hover highlight bar */}
          {hoveredTimestamp &&
            data.map((point, index) => {
              if (point.timestamp !== hoveredTimestamp) return null;
              const x = 60 + (index / Math.max(data.length - 1, 1)) * 920;
              return (
                <rect
                  key={`highlight-${point.timestamp}`}
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
          {data.map((point, index) => {
            const x = 60 + (index / Math.max(data.length - 1, 1)) * 920;
            return (
              <rect
                key={point.timestamp}
                x={x - 10}
                y="20"
                width="20"
                height="360"
                fill="transparent"
                style={{ cursor: "pointer" }}
                onMouseEnter={() => handleBarHover(point.timestamp)}
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
              // Create a temporary text element to measure label width (approximate)
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
                {formatTimeToNearest5Min(data[0].timestamp)}
              </text>

              {/* End time (rightmost) */}
              <text
                x="980"
                y="10"
                fill="rgba(255, 255, 255, 0.7)"
                fontSize="12"
                textAnchor="end"
              >
                {formatTimeToNearest5Min(data[data.length - 1].timestamp)}
              </text>

              {/* Hovered time (above highlighted section) */}
              {hoveredTimestamp &&
                data.map((point, index) => {
                  if (point.timestamp !== hoveredTimestamp) return null;
                  const x = 60 + (index / Math.max(data.length - 1, 1)) * 920;
                  return (
                    <text
                      key={`time-${point.timestamp}`}
                      x={x}
                      y="5"
                      fill="rgba(255, 255, 255, 0.95)"
                      fontSize="14"
                      fontWeight="600"
                      textAnchor="middle"
                    >
                      {formatTimeToNearest5Min(point.timestamp)}
                    </text>
                  );
                })}
            </g>
          )}
        </svg>
      </div>

      {data.length === 0 && (
        <div className="no-data">
          No sentiment data available. Click Refresh to collect data.
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
          Samples 2000 posts from the BlueSky Firehose every 5 minutes and uses
          an LLM to perform sentiment analysis and topic extraction, these are
          the results! (Click on a word to search it, sometimes topics are
          NSFW!). Made with ❤️ by Garrett Peake
        </p>
      </footer>
    </div>
  );
}

export default App;
