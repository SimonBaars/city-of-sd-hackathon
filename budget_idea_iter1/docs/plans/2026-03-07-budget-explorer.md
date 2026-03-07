# SD Budget Explorer Dashboard — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an interactive Next.js dashboard with a D3 treemap showing San Diego's FY26 budget by department, drill-down into account categories, and linked council meeting votes.

**Architecture:** Next.js App Router serves a single-page dashboard. Budget CSV and council HTML are pre-processed by a Node script into JSON at build time. D3.js renders a zoomable treemap. Clicking a department shows sub-categories; clicking a category shows related council items in a slide panel.

**Tech Stack:** Next.js 14 (App Router), TypeScript, D3.js, Tailwind CSS, Node.js scripts for data processing.

---

## Data Sources

- **Budget CSV:** `https://seshat.datasd.org/operating_budget/budget_operating_datasd.csv` (548K rows)
  - Columns: `amount, report_fy, budget_cycle, fund_type, fund_number, dept_name, funds_center_number, account, account_number`
  - Filter to: `report_fy=26` (32,596 rows, most current)
- **Account Reference CSV:** `https://seshat.datasd.org/accounts_city_budget/budget_reference_accounts_datasd.csv`
  - Columns: `account_type, account_class, account_group, account, account_number`
  - Provides hierarchy: account_type → account_class → account
- **Council Meetings:** Already scraped to `council_meetings_raw.txt` (20 meetings, 15 with vote results)
  - Contains agenda items, vote outcomes ("Unanimous", "1234689-yea; 5-nay"), resolution numbers

---

### Task 1: Scaffold Next.js Project

**Files:**
- Create: `package.json`, `tsconfig.json`, `tailwind.config.ts`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`

**Step 1: Initialize Next.js with TypeScript and Tailwind**

Run:
```bash
cd /Users/nathankhosla/coding_projects/sd_claude_hack/budget_idea_iter1
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-import-alias --use-npm
```

Accept defaults. This creates the full scaffold.

**Step 2: Install D3**

Run:
```bash
npm install d3 @types/d3
```

**Step 3: Verify it runs**

Run: `npm run dev`
Expected: App starts on localhost:3000

**Step 4: Commit**

```bash
git init
git add -A
git commit -m "feat: scaffold Next.js project with D3"
```

---

### Task 2: Data Processing Script — Download & Parse Budget CSV

**Files:**
- Create: `scripts/process-data.ts`
- Create: `public/data/` (directory)

**Step 1: Write the data processing script**

```typescript
// scripts/process-data.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "public", "data");
const RAW_DIR = join(process.cwd(), "scripts", "raw");

// ---- Types ----
interface BudgetRow {
  amount: number;
  report_fy: string;
  budget_cycle: string;
  fund_type: string;
  fund_number: string;
  dept_name: string;
  funds_center_number: string;
  account: string;
  account_number: string;
}

interface AccountRef {
  account_type: string;
  account_class: string;
  account_group: string;
  account: string;
  account_number: string;
}

interface CategoryNode {
  name: string;
  value: number;
  children?: CategoryNode[];
}

interface DeptNode {
  name: string;
  value: number;
  fund_type: string;
  children: CategoryNode[];
}

interface BudgetTree {
  name: string;
  children: DeptNode[];
}

// ---- CSV Parser (no deps) ----
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
  return lines.slice(1).map((line) => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i] || "";
    });
    return row;
  });
}

// ---- Download helper ----
async function downloadFile(url: string, dest: string): Promise<void> {
  if (existsSync(dest)) {
    console.log(`  Cached: ${dest}`);
    return;
  }
  console.log(`  Downloading: ${url}`);
  const res = await fetch(url);
  const text = await res.text();
  writeFileSync(dest, text);
}

// ---- Main ----
async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(RAW_DIR, { recursive: true });

  // 1. Download CSVs
  console.log("Downloading data...");
  await downloadFile(
    "https://seshat.datasd.org/operating_budget/budget_operating_datasd.csv",
    join(RAW_DIR, "budget.csv")
  );
  await downloadFile(
    "https://seshat.datasd.org/accounts_city_budget/budget_reference_accounts_datasd.csv",
    join(RAW_DIR, "accounts.csv")
  );

  // 2. Parse account reference
  console.log("Parsing account reference...");
  const accountsRaw = parseCSV(readFileSync(join(RAW_DIR, "accounts.csv"), "utf-8"));
  const accountLookup = new Map<string, AccountRef>();
  for (const row of accountsRaw) {
    accountLookup.set(row.account_number, row as unknown as AccountRef);
  }

  // 3. Parse budget, filter FY26 expenses only
  console.log("Parsing budget...");
  const budgetRaw = parseCSV(readFileSync(join(RAW_DIR, "budget.csv"), "utf-8"));
  const fy26 = budgetRaw.filter(
    (r) => r.report_fy === "26" && r.account_number?.startsWith("5") // expenses start with 5
  );
  console.log(`  FY26 expense rows: ${fy26.length}`);

  // 4. Aggregate by department → account_type → account_class
  const deptMap = new Map<
    string,
    { fund_type: string; categories: Map<string, Map<string, number>> }
  >();

  for (const row of fy26) {
    const amount = parseFloat(row.amount) || 0;
    if (amount <= 0) continue;

    const dept = row.dept_name;
    const acctRef = accountLookup.get(row.account_number);
    const acctType = acctRef?.account_type || "Other";
    const acctClass = acctRef?.account_class || row.account || "Other";

    if (!deptMap.has(dept)) {
      deptMap.set(dept, { fund_type: row.fund_type, categories: new Map() });
    }
    const deptEntry = deptMap.get(dept)!;
    if (!deptEntry.categories.has(acctType)) {
      deptEntry.categories.set(acctType, new Map());
    }
    const typeMap = deptEntry.categories.get(acctType)!;
    typeMap.set(acctClass, (typeMap.get(acctClass) || 0) + amount);
  }

  // 5. Build tree structure
  const tree: BudgetTree = {
    name: "City of San Diego FY2026 Budget",
    children: [],
  };

  for (const [deptName, deptData] of deptMap) {
    const deptNode: DeptNode = {
      name: deptName,
      value: 0,
      fund_type: deptData.fund_type,
      children: [],
    };

    for (const [typeName, classMap] of deptData.categories) {
      const typeNode: CategoryNode = {
        name: typeName,
        value: 0,
        children: [],
      };

      for (const [className, amount] of classMap) {
        typeNode.children!.push({ name: className, value: amount });
        typeNode.value += amount;
      }

      typeNode.children!.sort((a, b) => b.value - a.value);
      deptNode.children.push(typeNode);
      deptNode.value += typeNode.value;
    }

    deptNode.children.sort((a, b) => b.value - a.value);
    tree.children.push(deptNode);
  }

  tree.children.sort((a, b) => b.value - a.value);

  writeFileSync(join(DATA_DIR, "budget_tree.json"), JSON.stringify(tree, null, 2));
  console.log(`Wrote budget_tree.json (${tree.children.length} departments)`);
}

main().catch(console.error);
```

**Step 2: Run it**

Run: `npx tsx scripts/process-data.ts`
Expected: Creates `public/data/budget_tree.json` with department hierarchy

**Step 3: Verify output**

Run: `cat public/data/budget_tree.json | head -30`
Expected: JSON with `name`, `children` array of departments with values

**Step 4: Commit**

```bash
git add scripts/ public/data/
git commit -m "feat: add data processing script for budget CSV"
```

---

### Task 3: Data Processing — Parse Council Meeting Data

**Files:**
- Modify: `scripts/process-data.ts` (add council parsing)

**Step 1: Add council data parsing to the script**

Append to `main()` in `scripts/process-data.ts`, before the closing:

```typescript
  // 6. Parse council meetings
  console.log("Parsing council meetings...");
  const councilRaw = readFileSync(
    join(process.cwd(), "council_meetings_raw.txt"),
    "utf-8"
  );

  interface CouncilItem {
    meetingId: string;
    meetingDate: string;
    itemId: string;
    title: string;
    vote: string;
    resolution: string;
    relatedDepts: string[];
  }

  const meetings = councilRaw.split("===MEETING_").filter(Boolean);
  const councilItems: CouncilItem[] = [];

  // Build department keyword list for matching
  const deptNames = Array.from(deptMap.keys()).filter((d) => d.length > 3);
  const budgetKeywords = [
    "budget",
    "fund",
    "appropriat",
    "financ",
    "revenue",
    "contract",
    "fee",
    "capital",
    "cost",
    "expend",
    "allocat",
    "grant",
    "bond",
    "tax",
    "water",
    "sewer",
    "police",
    "fire",
    "park",
    "library",
    "transit",
    "housing",
    "infrastructure",
    "construction",
    "maintenance",
    "procurement",
    "lease",
    "settlement",
  ];

  for (const meeting of meetings) {
    const idMatch = meeting.match(/^(\d+)/);
    if (!idMatch) continue;
    const meetingId = idMatch[1];

    // Extract date from results
    const dateMatch = meeting.match(
      /DATE:\s*((?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY),?\s+\w+\s+\d+,\s+\d{4})/i
    );
    const meetingDate = dateMatch ? dateMatch[1] : "";

    // Extract items from ITEMS section
    const itemsSection = meeting.split("---ITEMS---")[1]?.split("---RESULTS---")[0] || "";
    const itemLines = itemsSection.split("\n").filter(Boolean);

    let currentItemId = "";
    for (const line of itemLines) {
      const itemIdMatch = line.match(/ITEMID: (\d+)/);
      if (itemIdMatch) {
        currentItemId = itemIdMatch[1];
        continue;
      }

      const itemMatch = line.match(/ITEM: (.+)/);
      if (itemMatch && currentItemId) {
        const title = itemMatch[1].trim();
        const titleLower = title.toLowerCase();

        // Check if budget-related
        const isBudgetRelated = budgetKeywords.some((kw) =>
          titleLower.includes(kw)
        );
        if (!isBudgetRelated) continue;

        // Find related departments
        const relatedDepts = deptNames.filter((dept) => {
          const deptLower = dept.toLowerCase();
          // Match department name or key words from dept name
          const deptWords = deptLower.split(/\s+/).filter((w) => w.length > 3);
          return deptWords.some((w) => titleLower.includes(w));
        });

        // Extract vote from results section
        let vote = "";
        let resolution = "";
        const resultsSection = meeting.split("---RESULTS---")[1] || "";

        // Try to find vote for this item by searching for keywords from the title
        const titleWords = title
          .split(/\s+/)
          .filter((w) => w.length > 5)
          .slice(0, 3);
        for (const word of titleWords) {
          const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const votePattern = new RegExp(
            `(?:Unanimous|\\d+-(?:not present|nay|yea|absent))[^\\n]*`,
            "i"
          );
          const nearText = resultsSection
            .split(escaped)
            .slice(1)
            .join("")
            .slice(0, 500);
          const voteMatch = nearText.match(votePattern);
          if (voteMatch) {
            vote = voteMatch[0].trim();
            break;
          }
        }

        // Extract resolution number
        const resMatch = resultsSection.match(
          /(?:R-\d{4}-\d+|O-\d{4}-\d+|R-202\d-\d+|O-202\d-\d+)/
        );
        if (resMatch) resolution = resMatch[0];

        // Default vote if we didn't find one
        if (!vote) {
          const anyVote = resultsSection.match(
            /Unanimous[^)}\n]*/i
          );
          if (anyVote) vote = anyVote[0].trim();
        }

        councilItems.push({
          meetingId,
          meetingDate,
          itemId: currentItemId,
          title,
          vote: vote || "Vote not recorded",
          resolution,
          relatedDepts:
            relatedDepts.length > 0 ? relatedDepts : ["Citywide"],
        });
        currentItemId = "";
      }
    }
  }

  writeFileSync(
    join(DATA_DIR, "council_items.json"),
    JSON.stringify(councilItems, null, 2)
  );
  console.log(`Wrote council_items.json (${councilItems.length} budget-related items)`);
```

**Step 2: Re-run the script**

Run: `npx tsx scripts/process-data.ts`
Expected: Creates both `budget_tree.json` and `council_items.json`

**Step 3: Verify council output**

Run: `cat public/data/council_items.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d),'items'); print(json.dumps(d[0],indent=2))"`
Expected: JSON array of council items with title, vote, relatedDepts

**Step 4: Commit**

```bash
git add scripts/ public/data/
git commit -m "feat: add council meeting data parsing"
```

---

### Task 4: Treemap Component — Department Level

**Files:**
- Create: `src/components/BudgetTreemap.tsx`
- Create: `src/types/budget.ts`
- Modify: `src/app/page.tsx`

**Step 1: Create types**

```typescript
// src/types/budget.ts
export interface TreeNode {
  name: string;
  value: number;
  fund_type?: string;
  children?: TreeNode[];
}

export interface CouncilItem {
  meetingId: string;
  meetingDate: string;
  itemId: string;
  title: string;
  vote: string;
  resolution: string;
  relatedDepts: string[];
}
```

**Step 2: Create the treemap component**

```tsx
// src/components/BudgetTreemap.tsx
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import type { TreeNode, CouncilItem } from "@/types/budget";

const FUND_COLORS: Record<string, string> = {
  "General Fund": "#3b82f6",
  "Enterprise Funds": "#10b981",
  "Capital Project Funds": "#f59e0b",
  "Special Revenue Funds": "#8b5cf6",
  "Internal Service Funds": "#ec4899",
  "Debt Service and Tax Funds": "#ef4444",
  "Other Funds": "#6b7280",
};

function formatCurrency(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

interface BudgetTreemapProps {
  data: TreeNode;
  councilItems: CouncilItem[];
  onSelectDept: (dept: string) => void;
}

export default function BudgetTreemap({
  data,
  councilItems,
  onSelectDept,
}: BudgetTreemapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentNode, setCurrentNode] = useState<TreeNode>(data);
  const [breadcrumb, setBreadcrumb] = useState<string[]>(["All Departments"]);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    content: string;
  } | null>(null);

  const goBack = useCallback(() => {
    if (breadcrumb.length > 1) {
      setCurrentNode(data);
      setBreadcrumb(["All Departments"]);
    }
  }, [breadcrumb, data]);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const svg = d3
      .select(svgRef.current)
      .attr("width", width)
      .attr("height", height);

    svg.selectAll("*").remove();

    const root = d3
      .hierarchy(currentNode)
      .sum((d) => (d.children ? 0 : d.value))
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    d3.treemap<TreeNode>()
      .size([width, height])
      .paddingInner(2)
      .paddingOuter(4)
      .round(true)(root);

    const leaves = root.leaves();

    const groups = svg
      .selectAll("g")
      .data(leaves)
      .join("g")
      .attr("transform", (d) => `translate(${d.x0},${d.y0})`);

    groups
      .append("rect")
      .attr("width", (d) => Math.max(0, d.x1 - d.x0))
      .attr("height", (d) => Math.max(0, d.y1 - d.y0))
      .attr("fill", (d) => {
        const fundType = d.data.fund_type || d.parent?.data.fund_type || "Other Funds";
        const base = FUND_COLORS[fundType] || FUND_COLORS["Other Funds"];
        return base;
      })
      .attr("opacity", 0.85)
      .attr("rx", 4)
      .attr("stroke", "#1e293b")
      .attr("stroke-width", 1)
      .style("cursor", "pointer")
      .on("mouseover", function (event, d) {
        d3.select(this).attr("opacity", 1).attr("stroke-width", 2);
        const rect = container.getBoundingClientRect();
        setTooltip({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          content: `${d.data.name}: ${formatCurrency(d.value || 0)}`,
        });
      })
      .on("mousemove", function (event) {
        const rect = container.getBoundingClientRect();
        setTooltip((prev) =>
          prev
            ? {
                ...prev,
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
              }
            : null
        );
      })
      .on("mouseout", function () {
        d3.select(this).attr("opacity", 0.85).attr("stroke-width", 1);
        setTooltip(null);
      })
      .on("click", (_, d) => {
        const node = d.data;
        if (breadcrumb.length === 1 && node.children && node.children.length > 0) {
          // Drill into department
          setCurrentNode(node);
          setBreadcrumb(["All Departments", node.name]);
        } else if (breadcrumb.length >= 1) {
          // At department level or deeper — show council items
          const deptName = breadcrumb.length > 1 ? breadcrumb[1] : node.name;
          onSelectDept(deptName);
        }
      });

    // Labels
    groups
      .append("text")
      .attr("x", 6)
      .attr("y", 16)
      .text((d) => {
        const w = d.x1 - d.x0;
        if (w < 60) return "";
        const name = d.data.name;
        const maxChars = Math.floor(w / 7);
        return name.length > maxChars
          ? name.slice(0, maxChars - 1) + "…"
          : name;
      })
      .attr("fill", "white")
      .attr("font-size", (d) => {
        const w = d.x1 - d.x0;
        return w > 200 ? "13px" : w > 100 ? "11px" : "9px";
      })
      .attr("font-weight", "600")
      .style("pointer-events", "none");

    // Amount labels
    groups
      .append("text")
      .attr("x", 6)
      .attr("y", 32)
      .text((d) => {
        const w = d.x1 - d.x0;
        const h = d.y1 - d.y0;
        if (w < 60 || h < 40) return "";
        return formatCurrency(d.value || 0);
      })
      .attr("fill", "rgba(255,255,255,0.8)")
      .attr("font-size", "11px")
      .style("pointer-events", "none");
  }, [currentNode, breadcrumb, onSelectDept]);

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 px-4 py-3 bg-slate-800 border-b border-slate-700">
        {breadcrumb.map((crumb, i) => (
          <span key={i} className="flex items-center gap-2">
            {i > 0 && <span className="text-slate-500">/</span>}
            <button
              onClick={i === 0 ? goBack : undefined}
              className={`text-sm font-medium ${
                i < breadcrumb.length - 1
                  ? "text-blue-400 hover:text-blue-300 cursor-pointer"
                  : "text-white"
              }`}
            >
              {crumb}
            </button>
          </span>
        ))}
      </div>

      {/* Treemap */}
      <div ref={containerRef} className="flex-1 relative bg-slate-900">
        <svg ref={svgRef} className="w-full h-full" />
        {tooltip && (
          <div
            className="absolute pointer-events-none bg-slate-800 text-white px-3 py-2 rounded-lg shadow-xl text-sm border border-slate-600 z-50"
            style={{
              left: tooltip.x + 12,
              top: tooltip.y - 28,
            }}
          >
            {tooltip.content}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 px-4 py-3 bg-slate-800 border-t border-slate-700">
        {Object.entries(FUND_COLORS).map(([name, color]) => (
          <div key={name} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: color }}
            />
            <span className="text-xs text-slate-400">{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 3: Update page.tsx**

```tsx
// src/app/page.tsx
"use client";

import { useState, useEffect } from "react";
import BudgetTreemap from "@/components/BudgetTreemap";
import type { TreeNode, CouncilItem } from "@/types/budget";

export default function Home() {
  const [budgetData, setBudgetData] = useState<TreeNode | null>(null);
  const [councilItems, setCouncilItems] = useState<CouncilItem[]>([]);
  const [selectedDept, setSelectedDept] = useState<string | null>(null);
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

  const filteredItems = selectedDept
    ? councilItems.filter(
        (item) =>
          item.relatedDepts.includes(selectedDept) ||
          item.relatedDepts.includes("Citywide")
      )
    : [];

  if (loading || !budgetData) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900 text-white">
        <div className="text-xl">Loading budget data...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-white">
      {/* Header */}
      <header className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">San Diego Budget Explorer</h1>
          <p className="text-sm text-slate-400 mt-1">
            FY2026 Operating Budget — Click departments to explore spending &amp;
            council decisions
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-blue-400">
            {formatTotal(budgetData)}
          </div>
          <div className="text-xs text-slate-400">Total FY26 Budget</div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Treemap */}
        <div
          className={`flex-1 transition-all duration-300 ${
            selectedDept ? "w-2/3" : "w-full"
          }`}
        >
          <BudgetTreemap
            data={budgetData}
            councilItems={councilItems}
            onSelectDept={setSelectedDept}
          />
        </div>

        {/* Council Items Panel */}
        {selectedDept && (
          <div className="w-1/3 border-l border-slate-700 bg-slate-800 overflow-y-auto">
            <div className="sticky top-0 bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{selectedDept}</h2>
              <button
                onClick={() => setSelectedDept(null)}
                className="text-slate-400 hover:text-white text-xl"
              >
                ×
              </button>
            </div>
            <div className="p-4">
              <h3 className="text-sm font-medium text-slate-400 mb-3">
                Related Council Actions ({filteredItems.length})
              </h3>
              {filteredItems.length === 0 ? (
                <p className="text-slate-500 text-sm">
                  No council items found for this department.
                </p>
              ) : (
                <div className="space-y-3">
                  {filteredItems.map((item, i) => (
                    <div
                      key={i}
                      className="bg-slate-700/50 rounded-lg p-3 border border-slate-600"
                    >
                      <p className="text-sm font-medium leading-snug">
                        {item.title}
                      </p>
                      <div className="flex items-center gap-3 mt-2">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            item.vote.includes("Unanimous")
                              ? "bg-green-900/50 text-green-400"
                              : item.vote.includes("not recorded")
                              ? "bg-slate-600 text-slate-300"
                              : "bg-yellow-900/50 text-yellow-400"
                          }`}
                        >
                          {item.vote}
                        </span>
                        {item.resolution && (
                          <span className="text-xs text-slate-500">
                            {item.resolution}
                          </span>
                        )}
                      </div>
                      {item.meetingDate && (
                        <p className="text-xs text-slate-500 mt-1">
                          {item.meetingDate}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatTotal(data: TreeNode): string {
  const total = data.children?.reduce((sum, c) => sum + c.value, 0) || 0;
  return `$${(total / 1_000_000_000).toFixed(2)}B`;
}
```

**Step 4: Verify it renders**

Run: `npm run dev`
Visit: `http://localhost:3000`
Expected: Treemap showing departments sized by budget, color-coded by fund type

**Step 5: Commit**

```bash
git add src/
git commit -m "feat: add treemap component and main page"
```

---

### Task 5: Responsive Sizing & Polish

**Files:**
- Modify: `src/app/layout.tsx` (update metadata)
- Modify: `src/app/globals.css` (minimal resets)

**Step 1: Update layout.tsx metadata**

```tsx
// src/app/layout.tsx — update the metadata export
export const metadata = {
  title: "SD Budget Explorer",
  description: "Interactive San Diego FY2026 Budget Dashboard with Council Voting Records",
};
```

**Step 2: Add resize handler to BudgetTreemap**

Add a `ResizeObserver` inside the `useEffect` in `BudgetTreemap.tsx` so the treemap redraws on window resize. Wrap the existing D3 rendering logic in a `draw()` function, call it initially, and call it again from the observer:

```typescript
// Inside the useEffect, wrap rendering in draw() and add:
const observer = new ResizeObserver(() => draw());
observer.observe(container);
return () => observer.disconnect();
```

**Step 3: Verify responsive behavior**

Resize the browser window. Expected: treemap reflows to fill available space.

**Step 4: Commit**

```bash
git add src/
git commit -m "feat: add responsive resize and metadata"
```

---

### Task 6: Search & Filter

**Files:**
- Create: `src/components/SearchBar.tsx`
- Modify: `src/app/page.tsx` (add search)

**Step 1: Create SearchBar component**

```tsx
// src/components/SearchBar.tsx
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
        className="w-64 bg-slate-700 text-white text-sm rounded-lg px-4 py-2 border border-slate-600 focus:border-blue-500 focus:outline-none placeholder-slate-400"
      />
      {query && (
        <button
          onClick={() => {
            setQuery("");
            onSearch("");
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
        >
          ×
        </button>
      )}
    </div>
  );
}
```

**Step 2: Add search to page.tsx header**

Add SearchBar to the header between the title and total. Filter `budgetData` children by search query and pass filtered data to the treemap. When searching, also highlight matching council items.

**Step 3: Verify search**

Type "police" in the search bar. Expected: treemap highlights/filters to show Police department prominently.

**Step 4: Commit**

```bash
git add src/
git commit -m "feat: add search/filter bar"
```

---

### Task 7: Final Testing & Build

**Files:**
- Modify: `package.json` (add data script)

**Step 1: Add data processing to build**

Add to `package.json` scripts:
```json
"prebuild": "npx tsx scripts/process-data.ts",
"data": "npx tsx scripts/process-data.ts"
```

**Step 2: Test production build**

Run:
```bash
npm run build
npm run start
```
Expected: Production build succeeds, app runs on localhost:3000

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete SD Budget Explorer dashboard"
```

---

## Summary

| Task | What | Estimated Complexity |
|------|------|---------------------|
| 1 | Scaffold Next.js | Simple |
| 2 | Budget data processing | Medium |
| 3 | Council data parsing | Medium |
| 4 | Treemap + page + council panel | Complex (core feature) |
| 5 | Responsive polish | Simple |
| 6 | Search/filter | Simple |
| 7 | Build & verify | Simple |
