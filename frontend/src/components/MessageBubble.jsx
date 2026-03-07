import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { User, Bot, Loader2, Database } from "lucide-react";
import ChartWidget from "./ChartWidget";
import TableWidget from "./TableWidget";

function ToolCallIndicator({ toolCalls }) {
  if (!toolCalls?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {toolCalls.map((tc, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-400 border border-slate-600/30"
        >
          <Database className="w-3 h-3" />
          {tc.tool === "query_data"
            ? "SQL query"
            : tc.tool === "list_tables"
              ? "Listing tables"
              : tc.tool === "describe_table"
                ? `Inspecting ${tc.input?.table_name || "table"}`
                : tc.tool === "create_visualization"
                  ? "Creating visualization"
                  : tc.tool}
        </span>
      ))}
    </div>
  );
}

function ArtifactRenderer({ artifact }) {
  if (
    artifact.type === "bar_chart" ||
    artifact.type === "line_chart" ||
    artifact.type === "pie_chart"
  ) {
    return <ChartWidget artifact={artifact} />;
  }
  if (artifact.type === "table") {
    return <TableWidget artifact={artifact} />;
  }
  if (artifact.type === "map_points") {
    return (
      <div className="text-xs text-sky-400 bg-sky-500/10 border border-sky-500/20 rounded-lg px-3 py-2 mt-2">
        📍 {artifact.data?.length || 0} points added to the map: {artifact.title}
      </div>
    );
  }
  return null;
}

export default function MessageBubble({ message }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] flex items-start gap-2">
          <div className="bg-sky-600 text-white px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm">
            {message.content}
          </div>
          <div className="flex-none w-7 h-7 rounded-full bg-sky-600/20 flex items-center justify-center mt-0.5">
            <User className="w-3.5 h-3.5 text-sky-400" />
          </div>
        </div>
      </div>
    );
  }

  const hasContent = message.content && message.content.length > 0;
  const isThinking = !hasContent && message.status;

  return (
    <div className="flex justify-start">
      <div className="max-w-[95%] flex items-start gap-2">
        <div className="flex-none w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center mt-0.5">
          <Bot className="w-3.5 h-3.5 text-emerald-400" />
        </div>
        <div className="min-w-0">
          <ToolCallIndicator toolCalls={message.toolCalls} />

          {isThinking && (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {message.status}
            </div>
          )}

          {hasContent && (
            <div className="chat-markdown text-sm text-slate-300 leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </div>
          )}

          {message.artifacts?.map((artifact) => (
            <ArtifactRenderer key={artifact.id} artifact={artifact} />
          ))}
        </div>
      </div>
    </div>
  );
}
