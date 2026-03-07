"use client";

import { useState } from "react";

interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
}

export default function SearchBar({
  onSearch,
  placeholder = "Search departments or council items...",
}: SearchBarProps) {
  const [query, setQuery] = useState("");

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onSearch(e.target.value);
        }}
        placeholder={placeholder}
        className="w-72 bg-slate-700 text-white text-sm rounded-lg px-4 py-2 border border-slate-600 focus:border-blue-500 focus:outline-none placeholder-slate-400"
      />
      {query && (
        <button
          onClick={() => {
            setQuery("");
            onSearch("");
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-lg"
        >
          ×
        </button>
      )}
    </div>
  );
}
