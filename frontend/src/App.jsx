import { useState, useCallback } from "react";
import { streamChat } from "./api";
import ChatPanel from "./components/ChatPanel";
import MapPanel from "./components/MapPanel";
import { Database, Sparkles } from "lucide-react";

const SUGGESTED_QUESTIONS = [
  {
    category: "Infrastructure",
    color: "sky",
    questions: [
      "Which council district has the most open pothole complaints?",
      "Show the top 20 streets with the worst pavement condition and the most complaints",
      "How has pothole complaint volume changed over the years?",
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
    category: "Budget",
    color: "emerald",
    questions: [
      "What are the largest departments by operating budget?",
      "Compare capital improvement spending across council districts",
    ],
  },
  {
    category: "Development",
    color: "violet",
    questions: [
      "How many development permits were issued per year?",
      "Which neighborhoods have the most active business tax certificates?",
    ],
  },
];

const CHIP_COLORS = {
  sky: "bg-sky-500/10 text-sky-400 border-sky-500/20 hover:bg-sky-500/20",
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20",
  emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20",
  violet: "bg-violet-500/10 text-violet-400 border-violet-500/20 hover:bg-violet-500/20",
};

export default function App() {
  const [messages, setMessages] = useState([]);
  const [mapLayers, setMapLayers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

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
                // Extract map layers
                const newMapLayers = event.artifacts
                  .filter((a) => a.type === "map_points")
                  .map((a) => ({
                    id: a.id,
                    title: a.title,
                    points: a.data,
                    config: a.config,
                  }));
                if (newMapLayers.length > 0) {
                  setMapLayers((prev) => [...prev, ...newMapLayers]);
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
    [messages, isLoading]
  );

  const showSuggestions = messages.length === 0;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex-none bg-navy-800 border-b border-slate-700/50 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-sky-500/20 rounded-lg flex items-center justify-center">
              <Database className="w-5 h-5 text-sky-400" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white leading-tight">
                San Diego Civic Data Explorer
              </h1>
              <p className="text-xs text-slate-400">
                109 datasets · AI-powered analysis
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Sparkles className="w-3.5 h-3.5" />
            Powered by Claude
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Map panel */}
        <div className="w-[55%] border-r border-slate-700/50">
          <MapPanel layers={mapLayers} />
        </div>

        {/* Chat panel */}
        <div className="w-[45%] flex flex-col min-h-0">
          {showSuggestions && (
            <div className="flex-none p-4 border-b border-slate-700/30 overflow-y-auto max-h-[45%]">
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
