import { useState, useRef, useEffect } from "react";
import { Send, Loader2 } from "lucide-react";
import MessageBubble from "./MessageBubble";

export default function ChatPanel({ messages, isLoading, onSend }) {
  const [input, setInput] = useState("");
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSend(input);
    setInput("");
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-slate-500 text-sm text-center px-4">
              Pick a question above or ask your own below
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="flex-none p-3 border-t border-slate-700/50"
      >
        <div className="flex items-center gap-2 bg-slate-800/50 rounded-xl px-4 py-2 border border-slate-700/50 focus-within:border-sky-500/40 transition-colors">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              isLoading ? "Analyzing..." : "Ask about San Diego data..."
            }
            disabled={isLoading}
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-500 outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="p-1.5 rounded-lg text-sky-400 hover:bg-sky-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
