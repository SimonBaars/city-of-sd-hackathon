"use client";

import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import * as d3 from "d3";
import { TreeNode, CouncilItem } from "@/types/budget";

const FUND_COLORS: Record<string, string> = {
  "General Fund": "#3b82f6",
  "Enterprise Funds": "#10b981",
  "Capital Project Funds": "#f59e0b",
  "Special Revenue Funds": "#8b5cf6",
  "Internal Service Funds": "#ec4899",
  "Debt Service and Tax Funds": "#ef4444",
  "Other Funds": "#6b7280",
};

// Departments below this % of total get grouped into "Other Departments"
const SMALL_DEPT_THRESHOLD = 0.01; // 1%

function formatCurrency(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

/**
 * Groups small departments (< threshold% of total) into an
 * "Other Departments" bucket. That bucket's children are the
 * original small depts, so drilling in shows them at readable size.
 */
function groupSmallDepts(data: TreeNode): TreeNode {
  if (!data.children) return data;

  const total = data.children.reduce((s, c) => s + c.value, 0);
  const threshold = total * SMALL_DEPT_THRESHOLD;

  const big: TreeNode[] = [];
  const small: TreeNode[] = [];

  for (const child of data.children) {
    if (child.value >= threshold) {
      big.push(child);
    } else {
      small.push(child);
    }
  }

  // Only group if there are multiple small depts
  if (small.length <= 1) return data;

  const otherValue = small.reduce((s, c) => s + c.value, 0);
  const otherNode: TreeNode = {
    name: `Other Departments (${small.length})`,
    value: otherValue,
    fund_type: "Other Funds",
    children: small.sort((a, b) => b.value - a.value),
  };

  return {
    ...data,
    children: [...big, otherNode].sort((a, b) => b.value - a.value),
  };
}

interface Props {
  data: TreeNode;
  councilItems: CouncilItem[];
  onSelectDept: (dept: string | null, subcategory?: string | null) => void;
}

export default function BudgetTreemap({ data, councilItems, onSelectDept }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  // breadcrumb is an array of TreeNodes representing the drill path
  const [drillStack, setDrillStack] = useState<TreeNode[]>([]);

  const currentNode = drillStack.length > 0 ? drillStack[drillStack.length - 1] : null;

  // At top level, group small depts. At deeper levels, show as-is.
  const displayData = useMemo(() => {
    if (currentNode) return currentNode;
    return groupSmallDepts(data);
  }, [data, currentNode]);

  const drillInto = useCallback((node: TreeNode) => {
    setDrillStack((prev) => [...prev, node]);
  }, []);

  const goBack = useCallback((index: number) => {
    if (index < 0) {
      setDrillStack([]);
      onSelectDept(null, null);
    } else {
      setDrillStack((prev) => prev.slice(0, index + 1));
    }
  }, [onSelectDept]);

  const drawTreemap = useCallback(() => {
    const container = containerRef.current;
    const svg = svgRef.current;
    if (!container || !svg) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    const sel = d3.select(svg);
    sel.selectAll("*").remove();
    sel.attr("width", width).attr("height", height);

    const root = d3
      .hierarchy(displayData)
      .sum((d) => (d.children ? 0 : d.value))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    d3.treemap<TreeNode>()
      .size([width, height])
      .paddingInner(2)
      .paddingOuter(4)
      .round(true)(root);

    const leaves = root.leaves() as d3.HierarchyRectangularNode<TreeNode>[];

    const getColor = (d: d3.HierarchyRectangularNode<TreeNode>): string => {
      let node: d3.HierarchyNode<TreeNode> | null = d;
      while (node) {
        if (node.data.fund_type) return FUND_COLORS[node.data.fund_type] || "#6b7280";
        node = node.parent;
      }
      return "#6b7280";
    };

    const tooltip = d3.select(tooltipRef.current);

    const g = sel
      .selectAll("g")
      .data(leaves)
      .join("g")
      .attr("transform", (d) => `translate(${d.x0},${d.y0})`);

    g.append("rect")
      .attr("width", (d) => Math.max(0, d.x1 - d.x0))
      .attr("height", (d) => Math.max(0, d.y1 - d.y0))
      .attr("rx", 4)
      .attr("fill", (d) => getColor(d))
      .attr("stroke", "#1e293b")
      .attr("stroke-width", 1)
      .style("cursor", "pointer")
      .on("mousemove", (event, d) => {
        // Build full path for tooltip
        const parts: string[] = [];
        let node: d3.HierarchyNode<TreeNode> | null = d;
        while (node && node.depth > 0) {
          parts.unshift(node.data.name);
          node = node.parent;
        }
        tooltip
          .style("opacity", "1")
          .style("left", `${event.pageX + 12}px`)
          .style("top", `${event.pageY - 28}px`)
          .html(
            `<strong>${parts.join(" › ")}</strong><br/>${formatCurrency(d.value ?? 0)}`
          );
      })
      .on("mouseleave", () => {
        tooltip.style("opacity", "0");
      })
      .on("click", (_event, d) => {
        // The leaf node the user actually clicked
        const leafName = d.data.name;

        // Find the depth-1 child (direct child of displayData)
        let target: d3.HierarchyNode<TreeNode> | null = d;
        while (target && target.depth > 1) target = target.parent;

        if (!target) return;
        const clickedNode = target.data;

        // At root level: drill into the clicked node
        if (drillStack.length === 0) {
          if (clickedNode.children && clickedNode.children.length > 0) {
            drillInto(clickedNode);
            if (!clickedNode.name.startsWith("Other Departments")) {
              onSelectDept(clickedNode.name, null);
            }
          } else {
            onSelectDept(clickedNode.name, null);
          }
        } else {
          // Inside "Other Departments": drill into the specific small dept
          if (drillStack[drillStack.length - 1].name.startsWith("Other Departments")
              && clickedNode.children && clickedNode.children.length > 0) {
            drillInto(clickedNode);
            onSelectDept(clickedNode.name, null);
          } else {
            // Drilled into a department — use the LEAF name as subcategory
            const deptName = drillStack[0].name.startsWith("Other Departments")
              ? drillStack[1]?.name || drillStack[0].name
              : drillStack[0].name;
            onSelectDept(deptName, leafName);
          }
        }
      });

    // Labels
    g.each(function (d) {
      const w = d.x1 - d.x0;
      const h = d.y1 - d.y0;
      const group = d3.select(this);

      // Build label parts: dept name + category path
      // At top level: "Public Utilities / Personnel"
      // When drilled in: just the leaf's own name
      let deptLabel = "";
      let categoryLabel = "";

      if (drillStack.length === 0) {
        // Collect the path from depth-1 (dept) down to the leaf
        const ancestors: string[] = [];
        let node: d3.HierarchyNode<TreeNode> | null = d;
        while (node && node.depth > 0) {
          ancestors.unshift(node.data.name);
          node = node.parent;
        }
        deptLabel = ancestors[0] || d.data.name;
        categoryLabel = ancestors.slice(1).join(" / ");
      } else {
        deptLabel = d.data.name;
      }

      if (w > 60 && h > 32) {
        const fontSize = w > 150 ? 13 : w > 100 ? 11 : 10;
        const maxChars = Math.floor(w / (fontSize * 0.55));

        // Line 1: Department name (bold)
        group
          .append("text")
          .attr("x", 6)
          .attr("y", 16)
          .attr("fill", "white")
          .attr("font-size", `${fontSize}px`)
          .attr("font-weight", "600")
          .style("pointer-events", "none")
          .text(deptLabel.length > maxChars ? deptLabel.slice(0, maxChars - 1) + "…" : deptLabel);

        let nextY = 32;

        // Line 2: Category path (lighter, only at top level and if space)
        if (categoryLabel && h > 50) {
          const catMaxChars = Math.floor(w / (fontSize * 0.5));
          group
            .append("text")
            .attr("x", 6)
            .attr("y", nextY)
            .attr("fill", "rgba(255,255,255,0.6)")
            .attr("font-size", `${Math.max(fontSize - 2, 9)}px`)
            .style("pointer-events", "none")
            .text(categoryLabel.length > catMaxChars ? categoryLabel.slice(0, catMaxChars - 1) + "…" : categoryLabel);
          nextY += 14;
        }

        // Line 3: Dollar amount
        if (h > nextY + 8) {
          group
            .append("text")
            .attr("x", 6)
            .attr("y", nextY)
            .attr("fill", "rgba(255,255,255,0.75)")
            .attr("font-size", "10px")
            .style("pointer-events", "none")
            .text(formatCurrency(d.value ?? 0));
        }
      } else if (w > 40 && h > 18) {
        group
          .append("text")
          .attr("x", 4)
          .attr("y", 13)
          .attr("fill", "white")
          .attr("font-size", "9px")
          .style("pointer-events", "none")
          .text(formatCurrency(d.value ?? 0));
      }
    });
  }, [displayData, drillInto, onSelectDept]);

  // Helper: resolve "Other Departments (N)" to actual dept name
  function getDeptName(name: string): string {
    if (name.startsWith("Other Departments")) return name;
    return name;
  }

  useEffect(() => {
    drawTreemap();
  }, [drawTreemap]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => drawTreemap());
    observer.observe(container);
    return () => observer.disconnect();
  }, [drawTreemap]);

  // Build breadcrumb trail
  const breadcrumbs = [
    { label: "All Departments", onClick: () => goBack(-1) },
    ...drillStack.map((node, i) => ({
      label: node.name,
      onClick: () => goBack(i),
    })),
  ];

  // Hint text for user
  const hintText = drillStack.length === 0
    ? "Click a department to see its budget breakdown and council actions"
    : drillStack[drillStack.length - 1]?.name.startsWith("Other Departments")
    ? "These are smaller departments — click any to see its breakdown"
    : "Budget breakdown by spending category";

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Breadcrumb + hint */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-2 text-sm text-slate-300">
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-slate-500">/</span>}
              <button
                onClick={crumb.onClick}
                className={
                  i < breadcrumbs.length - 1
                    ? "text-blue-400 hover:text-blue-300 underline cursor-pointer"
                    : "text-white font-semibold"
                }
              >
                {crumb.label}
              </button>
            </React.Fragment>
          ))}
        </div>
        <span className="text-xs text-slate-500 italic">{hintText}</span>
      </div>

      {/* Treemap */}
      <div ref={containerRef} className="flex-1 min-h-0 bg-slate-900 relative">
        <svg ref={svgRef} className="block w-full h-full" />
        <div
          ref={tooltipRef}
          className="fixed pointer-events-none bg-slate-800 text-white text-xs px-3 py-2 rounded shadow-lg border border-slate-600 z-50"
          style={{ opacity: 0, transition: "opacity 0.15s" }}
        />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 px-4 py-2 bg-slate-800 border-t border-slate-700 text-xs text-slate-300">
        {Object.entries(FUND_COLORS).map(([label, color]) => (
          <div key={label} className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ backgroundColor: color }}
            />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
