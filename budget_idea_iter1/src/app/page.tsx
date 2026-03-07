"use client";

import React, { useEffect, useState, useMemo } from "react";
import BudgetTreemap from "@/components/BudgetTreemap";
import SearchBar from "@/components/SearchBar";
import { TreeNode, CouncilItem } from "@/types/budget";

function formatTotal(value: number): string {
  return `$${(value / 1_000_000_000).toFixed(2)}B`;
}

function voteBadge(vote: string) {
  const lower = vote.toLowerCase();
  if (lower.startsWith("unanimous")) {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-green-900 text-green-300">
        Unanimous
      </span>
    );
  }
  if (lower.includes("yea") || lower.includes("nay")) {
    return (
      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-yellow-900 text-yellow-300">
        Split Vote
      </span>
    );
  }
  return (
    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-slate-700 text-slate-300">
      Not Recorded
    </span>
  );
}

export default function Home() {
  const [budgetData, setBudgetData] = useState<TreeNode | null>(null);
  const [councilItems, setCouncilItems] = useState<CouncilItem[]>([]);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [subcategoryFilter, setSubcategoryFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/data/budget_tree.json").then((r) => r.json()),
      fetch("/data/council_items.json").then((r) => r.json()),
    ]).then(([budget, council]) => {
      setBudgetData(budget);
      setCouncilItems(council);
      setLoading(false);
    });
  }, []);

  const filteredBudget = useMemo(() => {
    if (!budgetData || !searchQuery) return budgetData;
    const q = searchQuery.toLowerCase();
    const filtered = {
      ...budgetData,
      children: budgetData.children?.filter((dept) =>
        dept.name.toLowerCase().includes(q)
      ),
    };
    return filtered;
  }, [budgetData, searchQuery]);

  const deptItems = selectedDept
    ? councilItems.filter((item) =>
        item.relatedDepts.includes(selectedDept)
      )
    : [];

  const filteredItems = subcategoryFilter
    ? deptItems.filter((item) => item.subcategory === subcategoryFilter)
    : deptItems;

  // Get unique subcategories for this department's items
  const deptSubcategories = useMemo(() => {
    const cats = new Map<string, number>();
    for (const item of deptItems) {
      cats.set(item.subcategory, (cats.get(item.subcategory) || 0) + 1);
    }
    return Array.from(cats.entries()).sort((a, b) => b[1] - a[1]);
  }, [deptItems]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900 text-white text-xl">
        Loading budget data...
      </div>
    );
  }

  if (!budgetData) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900 text-red-400 text-xl">
        Failed to load budget data.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-slate-800 border-b border-slate-700 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            San Diego Budget Explorer
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Proposed FY2026 Operating Budget with Council Voting Records
          </p>
        </div>
        <SearchBar onSearch={setSearchQuery} />
        <div className="text-right">
          <p className="text-xs text-slate-400 uppercase tracking-wider">
            Total Budget
          </p>
          <p className="text-2xl font-bold text-blue-400">
            {formatTotal(budgetData.value)}
          </p>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Treemap area */}
        <div
          className={`flex flex-col transition-all duration-300 ${
            selectedDept ? "w-2/3" : "w-full"
          }`}
        >
          <BudgetTreemap
            data={filteredBudget || budgetData}
            councilItems={councilItems}
            onSelectDept={(dept, subcategory) => {
              setSelectedDept(dept);
              // Map treemap account_class names to council subcategory names
              if (subcategory) {
                // The treemap tile name (account_class) may match the council subcategory directly
                // or may be a child of an account_type that matches
                const directMatch = ["Contracts & Services", "Capital Expenditures", "Supplies",
                  "Information Technology", "Energy and Utilities", "Debt", "Transfers Out",
                  "Personnel Cost", "Fringe Benefits", "Contingencies", "Other"];
                if (directMatch.includes(subcategory)) {
                  setSubcategoryFilter(subcategory);
                } else if (subcategory === "Personnel" || subcategory === "Non-Personnel") {
                  // Account type level — don't filter to a specific subcategory
                  setSubcategoryFilter(null);
                } else {
                  setSubcategoryFilter(null);
                }
              } else {
                setSubcategoryFilter(null);
              }
            }}
          />
        </div>

        {/* Council items panel */}
        {selectedDept && (
          <div className="w-1/3 bg-slate-800 border-l border-slate-700 flex flex-col min-h-0">
            <div className="px-4 py-3 border-b border-slate-700 shrink-0">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{selectedDept}</h2>
                <button
                  onClick={() => setSelectedDept(null)}
                  className="text-slate-400 hover:text-white text-2xl leading-none px-2"
                >
                  &times;
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Related Council Actions ({filteredItems.length}{subcategoryFilter ? ` of ${deptItems.length}` : ""})
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Categories are estimated from item titles and may not be exact.
              </p>
              {deptSubcategories.length > 1 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  <button
                    onClick={() => setSubcategoryFilter(null)}
                    className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                      !subcategoryFilter
                        ? "bg-blue-600 border-blue-500 text-white"
                        : "border-slate-600 text-slate-400 hover:text-white hover:border-slate-400"
                    }`}
                  >
                    All ({deptItems.length})
                  </button>
                  {deptSubcategories.map(([cat, count]) => (
                    <button
                      key={cat}
                      onClick={() => setSubcategoryFilter(subcategoryFilter === cat ? null : cat)}
                      className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                        subcategoryFilter === cat
                          ? "bg-blue-600 border-blue-500 text-white"
                          : "border-slate-600 text-slate-400 hover:text-white hover:border-slate-400"
                      }`}
                    >
                      {cat} ({count})
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {filteredItems.length === 0 && (
                <div className="text-center mt-8 px-4">
                  <p className="text-slate-500 text-sm">
                    No council items found{subcategoryFilter ? ` for "${subcategoryFilter}"` : " for this department"}.
                  </p>
                  {subcategoryFilter && (
                    <p className="text-slate-600 text-xs mt-2 leading-relaxed">
                      Most spending in this category is authorized through the annual budget
                      adoption rather than individual council actions. Personnel costs, for
                      example, are funded when the council approves the overall department budget
                      each fiscal year.
                    </p>
                  )}
                  {subcategoryFilter && deptItems.length > 0 && (
                    <button
                      onClick={() => setSubcategoryFilter(null)}
                      className="mt-3 text-xs text-blue-400 hover:text-blue-300 underline"
                    >
                      Show all {deptItems.length} actions for {selectedDept}
                    </button>
                  )}
                </div>
              )}
              {filteredItems.map((item) => (
                <div
                  key={item.itemId}
                  className="bg-slate-900 rounded-lg p-3 border border-slate-700"
                >
                  <p className="text-sm font-medium leading-snug mb-2">
                    {item.title}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap text-xs text-slate-400">
                    {voteBadge(item.vote)}
                    <span className="px-1.5 py-0.5 rounded bg-slate-700/80 text-slate-300">
                      {item.subcategory}
                    </span>
                    {item.resolution && (
                      <span className="text-slate-500">{item.resolution}</span>
                    )}
                    <span className="text-slate-500">{item.meetingDate}</span>
                  </div>
                  <a
                    href={`https://sandiego.hylandcloud.com/211agendaonlinecouncil/Meetings/ViewMeeting?id=${item.meetingId}&doctype=1&site=council`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-xs text-blue-400 hover:text-blue-300 hover:underline"
                  >
                    View meeting on City Council site →
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
