export default function TableWidget({ artifact }) {
  const { title, data, config = {} } = artifact;
  if (!data || data.length === 0) return null;

  const columns = Object.keys(data[0]);

  return (
    <div className="mt-3 bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-700/50">
        <h4 className="text-sm font-medium text-slate-200">{title}</h4>
        <span className="text-xs text-slate-500">{data.length} rows</span>
      </div>
      <div className="overflow-x-auto max-h-80">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-800">
              {columns.map((col) => (
                <th
                  key={col}
                  className="px-3 py-2 text-left text-slate-400 font-medium whitespace-nowrap sticky top-0 bg-slate-800"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr
                key={i}
                className="border-t border-slate-700/30 hover:bg-slate-700/20"
              >
                {columns.map((col) => (
                  <td
                    key={col}
                    className="px-3 py-1.5 text-slate-300 whitespace-nowrap max-w-xs truncate"
                  >
                    {row[col] != null ? String(row[col]) : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
