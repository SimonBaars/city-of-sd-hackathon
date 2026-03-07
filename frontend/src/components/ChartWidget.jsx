import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const COLORS = [
  "#0ea5e9",
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
  "#ec4899",
  "#f97316",
  "#06b6d4",
  "#84cc16",
];

const tooltipStyle = {
  contentStyle: {
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "8px",
    fontSize: "12px",
    color: "#e2e8f0",
  },
};

function formatNumber(val) {
  if (typeof val !== "number") return val;
  if (Math.abs(val) >= 1e6) return `${(val / 1e6).toFixed(1)}M`;
  if (Math.abs(val) >= 1e3) return `${(val / 1e3).toFixed(1)}K`;
  return val.toLocaleString();
}

export default function ChartWidget({ artifact }) {
  const { type, title, data, config = {} } = artifact;
  const xKey = config.x_key || (data[0] ? Object.keys(data[0])[0] : "x");
  const yKeys =
    config.y_keys ||
    (data[0]
      ? Object.keys(data[0]).filter(
          (k) => k !== xKey && typeof data[0][k] === "number"
        )
      : ["value"]);

  return (
    <div className="mt-3 bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
      <h4 className="text-sm font-medium text-slate-200 mb-3">{title}</h4>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          {type === "bar_chart" ? (
            <BarChart data={data} margin={{ left: 10, right: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey={xKey}
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                tickLine={false}
                angle={data.length > 8 ? -35 : 0}
                textAnchor={data.length > 8 ? "end" : "middle"}
                height={data.length > 8 ? 60 : 30}
              />
              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                tickLine={false}
                tickFormatter={formatNumber}
              />
              <Tooltip {...tooltipStyle} formatter={formatNumber} />
              {yKeys.length > 1 && <Legend />}
              {yKeys.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={COLORS[i % COLORS.length]}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          ) : type === "line_chart" ? (
            <LineChart data={data} margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey={xKey}
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                tickLine={false}
                tickFormatter={formatNumber}
              />
              <Tooltip {...tooltipStyle} formatter={formatNumber} />
              {yKeys.length > 1 && <Legend />}
              {yKeys.map((key, i) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={data.length < 30}
                />
              ))}
            </LineChart>
          ) : type === "pie_chart" ? (
            <PieChart>
              <Pie
                data={data}
                dataKey={yKeys[0]}
                nameKey={xKey}
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={({ name, percent }) =>
                  `${name} (${(percent * 100).toFixed(0)}%)`
                }
                labelLine={true}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip {...tooltipStyle} formatter={formatNumber} />
            </PieChart>
          ) : null}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
