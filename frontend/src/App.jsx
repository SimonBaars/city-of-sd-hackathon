import React, { useState, useCallback } from "react";
import { streamChat } from "./api";
import ChatPanel from "./components/ChatPanel";
import MapPanel from "./components/MapPanel";
import { Database, Sparkles, Map, X } from "lucide-react";

const SUGGESTED_QUESTIONS = [
  {
    category: "Council Voting",
    color: "rose",
    questions: [
      "Which council members vote together most often?",
      "Show each council member's voting attendance rate",
      "How do council members vote on Housing vs Public Safety issues?",
    ],
  },
  {
    category: "Infrastructure",
    color: "sky",
    questions: [
      "Which council district has the most open pothole complaints?",
      "Show the top 20 streets with the most complaints",
      "How many miles of street are within 200 feet of SD schools?",
    ],
  },
  {
    category: "Safety",
    color: "amber",
    questions: [
      "Compare police calls for service across council districts",
      "What are the most common types of Get It Done 311 reports?",
      "Show fire incident counts by community planning area",
    ],
  },
  {
    category: "Budget & Development",
    color: "emerald",
    questions: [
      "What are the largest departments by operating budget?",
      "How many development permits were issued per year?",
      "Which neighborhoods have the most active business tax certificates?",
    ],
  },
];

const CHIP_COLORS = {
  rose: "bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/20",
  sky: "bg-sky-500/10 text-sky-400 border-sky-500/20 hover:bg-sky-500/20",
  amber:
    "bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20",
  emerald:
    "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20",
};

export default function App() {
  const [messages, setMessages] = useState([]);
  const [mapLayers, setMapLayers] = useState([]);
  const [mapChoropleths, setMapChoropleths] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showMapPanel, setShowMapPanel] = useState(false);

  const hasMapData = mapLayers.length > 0 || mapChoropleths.length > 0;

  const handleSend = useCallback(
    async (text) => {
      if (!text.trim() || isLoading) return;

      const userMsg = { role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      const assistantMsg = {
        role: "assistant",
        content: "",
        artifacts: [],
        toolCalls: [],
        status: "",
      };
      setMessages((prev) => [...prev, assistantMsg]);

      const history = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      try {
        for await (const event of streamChat(text, history)) {
          setMessages((prev) => {
            const updated = [...prev];
            const last = { ...updated[updated.length - 1] };

            switch (event.type) {
              case "status":
                last.status = event.text;
                break;
              case "tool_call":
                last.toolCalls = [
                  ...(last.toolCalls || []),
                  { tool: event.tool, input: event.input },
                ];
                last.status = `Querying: ${event.tool}...`;
                break;
              case "tool_result":
                last.status = `Got results from ${event.tool}`;
                break;
              case "text":
                last.content = event.text;
                last.status = "";
                break;
              case "artifacts":
                last.artifacts = event.artifacts;
                for (const a of event.artifacts) {
                  if (a.type === "map_points") {
                    setMapLayers((prev) => [
                      ...prev,
                      {
                        id: a.id,
                        title: a.title,
                        points: a.data,
                        config: a.config,
                      },
                    ]);
                    setShowMapPanel(true);
                  }
                  if (a.type === "choropleth") {
                    setMapChoropleths((prev) => [
                      ...prev,
                      {
                        id: a.id,
                        title: a.title,
                        data: a.data,
                        config: a.config,
                      },
                    ]);
                    setShowMapPanel(true);
                  }
                }
                break;
              case "done":
                break;
            }

            updated[updated.length - 1] = last;
            return updated;
          });
        }
      } catch (err) {
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: `Error: ${err.message}`,
            status: "",
          };
          return updated;
        });
      }

      setIsLoading(false);
    },
    [messages, isLoading],
  );

  const showSuggestions = messages.length === 0;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex-none bg-navy-800 border-b border-slate-700/50 px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-sky-500/20 rounded-lg flex items-center justify-center">
              <Database className="w-5 h-5 text-sky-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white leading-tight">
                OpenSD
              </h1>
              <p className="text-xs text-slate-400 hidden sm:block">
                San Diego's open data, explored by AI
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {hasMapData && (
              <button
                onClick={() => setShowMapPanel((v) => !v)}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors sm:hidden ${
                  showMapPanel
                    ? "bg-sky-500/20 border-sky-500/30 text-sky-300"
                    : "bg-slate-800/80 border-slate-600/50 text-slate-400"
                }`}
              >
                <Map className="w-3.5 h-3.5" />
                Map
              </button>
            )}
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Powered by Claude</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Map panel - desktop: side panel when data exists; mobile: overlay */}
        {hasMapData && (
          <div
            className={`${
              showMapPanel ? "flex" : "hidden"
            } sm:flex flex-col border-r border-slate-700/50
            absolute inset-0 z-20 sm:relative sm:z-auto sm:w-[55%]`}
          >
            <div className="sm:hidden absolute top-3 left-3 z-[1001]">
              <button
                onClick={() => setShowMapPanel(false)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-600/50 text-slate-300 backdrop-blur-sm"
              >
                <X className="w-3.5 h-3.5" />
                Back to chat
              </button>
            </div>
            <MapPanel
              layers={mapLayers}
              choropleths={mapChoropleths}
            />
          </div>
        )}

        {/* Chat panel - full width on mobile, or when no map data on desktop */}
        <div
          className={`flex flex-col min-h-0 w-full ${
            hasMapData ? "sm:w-[45%]" : ""
          }`}
        >
          {showSuggestions && (
            <div className="flex-none p-4 border-b border-slate-700/30 overflow-y-auto max-h-[55vh] sm:max-h-[45%]">
              <p className="text-sm text-slate-400 mb-3">
                Ask anything about San Diego civic data:
              </p>
              {SUGGESTED_QUESTIONS.map((group) => (
                <div key={group.category} className="mb-3">
                  <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                    {group.category}
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {group.questions.map((q) => (
                      <button
                        key={q}
                        onClick={() => handleSend(q)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-colors cursor-pointer ${CHIP_COLORS[group.color]}`}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <ChatPanel
            messages={messages}
            isLoading={isLoading}
            onSend={handleSend}
          />
        </div>
      </div>
    </div>
  );
}
