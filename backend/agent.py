"""Claude-powered agent with tool use for querying San Diego civic data."""

import json
import logging
from pathlib import Path

import duckdb
from anthropic import Anthropic

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")

DB_PATH = Path(__file__).parent / "san_diego.duckdb"
MAX_TOOL_ROUNDS = 50
MODEL = "claude-sonnet-4-6"

TOOLS = [
    {
        "name": "query_data",
        "description": (
            "Execute a SQL query against the San Diego open data DuckDB database. "
            "Use DuckDB SQL syntax. Returns up to `limit` rows as JSON. "
            "For large tables, always use WHERE/LIMIT. "
            "Columns with dates may be VARCHAR — cast with TRY_CAST(col AS DATE)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sql": {"type": "string", "description": "SQL query to execute"},
                "limit": {
                    "type": "integer",
                    "description": "Max rows to return (default 200)",
                    "default": 200,
                },
            },
            "required": ["sql"],
        },
    },
    {
        "name": "list_tables",
        "description": (
            "List available tables in the database. Returns table name, dataset, "
            "row count, and column names. Use the optional filter to search by keyword."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "filter": {
                    "type": "string",
                    "description": "Optional keyword to filter table names",
                }
            },
        },
    },
    {
        "name": "describe_table",
        "description": (
            "Get detailed info for a table: column names and types, row count, "
            "and 5 sample rows. Use this before writing queries to understand the schema."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "table_name": {"type": "string", "description": "Exact table name"}
            },
            "required": ["table_name"],
        },
    },
    {
        "name": "create_visualization",
        "description": (
            "Create a visualization for the user. Call this AFTER querying data "
            "when results would benefit from a visual. The frontend renders it inline.\n"
            "Types:\n"
            "- bar_chart, line_chart, pie_chart: standard charts with x_key/y_keys\n"
            "- table: data table\n"
            "- map_points: points on a map. Each object needs lat/lng. Use color_key to "
            "color points by a category field, size_key to scale radius by a numeric field.\n"
            "- choropleth: colors council districts by value. Data should have a 'district' "
            "field (1-9) and a numeric 'value' field. Great for per-district comparisons.\n\n"
            "IMPORTANT: For map_points and table with many rows (>50), use `sql` instead of `data` "
            "to avoid token limits. The backend will execute the SQL and attach the results directly. "
            "You can still pass `data` for small datasets (charts, choropleths)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "enum": ["bar_chart", "line_chart", "pie_chart", "table", "map_points", "choropleth"],
                },
                "title": {"type": "string"},
                "data": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "Array of data objects (for small datasets: charts, choropleths)",
                },
                "sql": {
                    "type": "string",
                    "description": "SQL query to execute for the visualization data. Use INSTEAD of data for large results (map_points, big tables). The backend runs this query and attaches the results.",
                },
                "x_key": {"type": "string", "description": "Key for x-axis / categories"},
                "y_keys": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Keys for y-axis values",
                },
                "lat_key": {"type": "string", "description": "Latitude field (map_points)"},
                "lng_key": {"type": "string", "description": "Longitude field (map_points)"},
                "label_key": {"type": "string", "description": "Label field for popups (map_points) or district label (choropleth)"},
                "color_key": {"type": "string", "description": "Category field to color points by (map_points)"},
                "size_key": {"type": "string", "description": "Numeric field to scale point radius (map_points)"},
                "value_key": {"type": "string", "description": "Numeric field for choropleth coloring"},
            },
            "required": ["type", "title"],
        },
    },
]


def _build_system_prompt(table_summary: str) -> str:
    return f"""You are **OpenSD**, an AI analyst with access to the City of San Diego's Open Data Portal loaded into a DuckDB database.

You help residents, journalists, city staff, and researchers explore civic data through conversation.

## How to respond
1. **Go straight to querying** — the full table schema is below; you rarely need list_tables/describe_table. Use them only if you need sample values or aren't sure about data content.
2. **Query precisely** — write efficient SQL. Always LIMIT exploratory queries. Aggregate for summaries.
3. **Visualize** — call create_visualization for comparisons (bar_chart), trends (line_chart), geographic data (map_points), or detailed breakdowns (table). For map_points and large tables, pass a `sql` query instead of inline `data` — the backend executes it directly. Only embed `data` inline for small datasets (<50 rows) like charts and choropleths.
4. **Explain** — provide clear, accessible analysis. Cite specific numbers. Note caveats.
5. **Be efficient** — minimize tool rounds. Combine queries when possible. Don't call list_tables if the table list below already tells you what you need.

## Council Voting Data (Jan 2025 – Mar 2026, 1216 items, 72 meetings)
Three tables capture San Diego City Council voting records:
- **council_members**: name (PK), district (1-9). Members: Joe LaCava (D1), Jennifer Campbell (D2), Stephen Whitburn (D3), Henry Foster III (D4), Marni von Wilpert (D5), Kent Lee (D6), Raul Campillo (D7), Vivian Moreno (D8), Sean Elo-Rivera (D9).
- **vote_items**: item_id (PK), date, item_number, description, action (Adopted/Introduced/etc), reference (ordinance/resolution number), motion_by, second_by, unanimous (bool), vote_raw, meeting_id, source_url.
- **council_votes**: item_id, member_name, vote (yes/no/absent/recused), date. Join to vote_items on item_id, to council_members on member_name.

Useful voting queries: attendance rates (absent vs total), agreement matrices (how often pairs vote the same way on non-unanimous items), who makes the most motions, unanimous vs contentious (137 split votes), and cross-referencing council_district with other civic data.

## Council Meeting Transcript Analysis (47 meetings, Jan–Nov 2025)
Five tables from AI-transcribed council meeting recordings correlated with official docket briefing agendas:
- **meeting_sessions**: date (PK), duration_seconds, duration_formatted, docket_file, num_docket_items, num_transcript_items, num_public_comments. One row per meeting.
- **meeting_docket_items**: id, date, item_letter (A/B/C...), title, staff, discussed_in_transcript (bool), keyword_matches, matched_phrases, discussion_found. 281 items from official docket briefing agendas.
- **meeting_discussion_points**: id, docket_item_id (FK→meeting_docket_items.id), date, item_letter, point (TEXT — actual transcript excerpt), speaker (int), timestamp_seconds, timestamp, relevance_score. 548 key discussion points extracted from transcripts. The `point` field contains what was actually said.
- **meeting_transcript_items**: id, date, item_id (e.g. "200", "S400"), category (numbered/consent/other), context_excerpt (TEXT), in_docket, discussed_in_transcript, discussion_mentions, estimated_discussion_seconds, estimated_discussion_time, outcome (approved/approved unanimously/continued/unknown). 344 agenda items from actual meeting recordings.
- **meeting_public_comments**: id, date, section_label, timestamp_seconds, timestamp, duration_seconds, num_speakers, speaker_ids.

Cross-reference: meeting_sessions.date joins to vote_items.date, meeting_docket_items.date, etc. Item discussion times reveal which topics generated the most debate. Docket items have titles matching vote_items.description for correlation.

## Key cross-reference fields
- **council_district** (10+ tables): political districts 1-9. Links to council_members.district.
- **comm_plan_name / cpname** (~10 tables): ~50 community neighborhoods
- **iamfloc** (8 tables): street segment ID linking complaints → repairs → conditions
- **beat** (9 tables): police geography
- **lat / lng** (21+ tables): coordinates for spatial analysis
- **zipcode** (19+ tables): ZIP-level aggregation

## Important SQL notes
- Date columns are often VARCHAR — use TRY_CAST(col AS DATE) or col::DATE
- Use double quotes for table/column names with special chars: SELECT * FROM "my_table"
- DuckDB supports: ILIKE, LIST_AGG, APPROX_COUNT_DISTINCT, EPOCH(), etc.
- For geographic distance: use haversine or simple lat/lng math. 1 degree lat ≈ 111,000m. 1 degree lng ≈ 85,000m at SD latitude.
- 200 feet ≈ 0.061 km ≈ 0.00055 degrees latitude
- DuckDB does NOT have PostGIS. Use simple Euclidean distance on lat/lng for proximity queries.

## Available tables
{table_summary}
"""


class SanDiegoAgent:
    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self.client = Anthropic()
        self.table_summary = self._build_table_summary()

    def _get_connection(self) -> duckdb.DuckDBPyConnection:
        return duckdb.connect(str(self.db_path), read_only=True)

    def _build_table_summary(self) -> str:
        con = self._get_connection()
        try:
            rows = con.execute(
                "SELECT table_name, dataset, row_count, columns FROM _metadata ORDER BY table_name"
            ).fetchall()
            col_types = {}
            for tname, _, _, _ in rows:
                try:
                    type_rows = con.execute(
                        f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '{tname}'"
                    ).fetchall()
                    col_types[tname] = {r[0]: r[1] for r in type_rows}
                except Exception:
                    col_types[tname] = {}
        finally:
            con.close()

        lines = []
        for tname, dataset, row_count, columns_json in rows:
            cols = json.loads(columns_json) if columns_json else []
            types = col_types.get(tname, {})
            col_parts = []
            for c in cols:
                dtype = types.get(c, "")
                short = dtype.replace("VARCHAR", "str").replace("BIGINT", "int").replace("DOUBLE", "float").replace("INTEGER", "int").replace("BOOLEAN", "bool").replace("DATE", "date").replace("TIMESTAMP", "ts")
                col_parts.append(f"{c}({short})" if short else c)
            col_str = ", ".join(col_parts[:15])
            if len(cols) > 15:
                col_str += f", ... (+{len(cols)-15} more)"
            lines.append(f"- **{tname}** [{dataset}] ({row_count:,} rows): {col_str}")
        return "\n".join(lines)

    def _exec_query(self, sql: str, limit: int = 200) -> dict:
        con = self._get_connection()
        try:
            result = con.execute(sql)
            columns = [desc[0] for desc in result.description]
            rows = result.fetchmany(limit)
            data = [dict(zip(columns, row)) for row in rows]
            return {"columns": columns, "data": data, "row_count": len(data)}
        except Exception as e:
            return {"error": str(e)}
        finally:
            con.close()

    def _exec_list_tables(self, filter_kw: str | None = None) -> list[dict]:
        con = self._get_connection()
        try:
            sql = "SELECT table_name, dataset, row_count, columns FROM _metadata"
            if filter_kw:
                sql += f" WHERE table_name ILIKE '%{filter_kw}%' OR dataset ILIKE '%{filter_kw}%'"
            sql += " ORDER BY table_name"
            rows = con.execute(sql).fetchall()
            return [
                {
                    "table_name": r[0],
                    "dataset": r[1],
                    "row_count": r[2],
                    "columns": json.loads(r[3]) if r[3] else [],
                }
                for r in rows
            ]
        finally:
            con.close()

    def _exec_describe(self, table_name: str) -> dict:
        con = self._get_connection()
        try:
            cols = con.execute(f'PRAGMA table_info("{table_name}")').fetchall()
            col_info = [{"name": c[1], "type": c[2]} for c in cols]
            sample = con.execute(f'SELECT * FROM "{table_name}" LIMIT 5').fetchall()
            col_names = [c[1] for c in cols]
            sample_dicts = [dict(zip(col_names, row)) for row in sample]
            count = con.execute(f'SELECT count(*) FROM "{table_name}"').fetchone()[0]
            return {
                "table_name": table_name,
                "row_count": count,
                "columns": col_info,
                "sample_rows": sample_dicts,
            }
        except Exception as e:
            return {"error": str(e)}
        finally:
            con.close()

    def _execute_tool(self, name: str, input_data: dict, artifacts: list) -> str:
        log.info("Tool call: %s  input: %s", name, json.dumps(input_data, default=str)[:500])
        if name == "query_data":
            result = self._exec_query(input_data["sql"], input_data.get("limit", 200))
            log.info("  -> %d rows returned", len(result.get("data", [])))
            return json.dumps(result, default=str)

        if name == "list_tables":
            result = self._exec_list_tables(input_data.get("filter"))
            log.info("  -> %d tables", len(result))
            return json.dumps(result, default=str)

        if name == "describe_table":
            result = self._exec_describe(input_data["table_name"])
            return json.dumps(result, default=str)

        if name == "create_visualization":
            data = input_data.get("data", [])
            viz_sql = input_data.get("sql")
            if viz_sql and not data:
                query_result = self._exec_query(viz_sql, limit=5000)
                if "error" in query_result:
                    return json.dumps({"error": f"Visualization SQL failed: {query_result['error']}"})
                data = query_result.get("data", [])
                log.info("  viz sql returned %d rows", len(data))

            artifact = {
                "id": f"viz_{len(artifacts)}",
                "type": input_data["type"],
                "title": input_data.get("title", ""),
                "data": data,
                "config": {
                    k: v
                    for k, v in input_data.items()
                    if k not in ("type", "title", "data", "sql")
                },
            }
            artifacts.append(artifact)
            return json.dumps({"status": "ok", "artifact_id": artifact["id"], "row_count": len(data)})

        return json.dumps({"error": f"Unknown tool: {name}"})

    def chat_stream(self, message: str, history: list[dict]):
        """
        Generator that yields SSE-style event dicts during the agent loop.

        Events:
          {"type": "status", "text": "..."}
          {"type": "tool_call", "tool": "...", "input": {...}}
          {"type": "tool_result", "tool": "...", "summary": "..."}
          {"type": "text", "text": "..."}
          {"type": "artifacts", "artifacts": [...]}
          {"type": "done"}
        """
        messages = []
        for h in history:
            messages.append({"role": h["role"], "content": h["content"]})
        messages.append({"role": "user", "content": message})

        artifacts: list[dict] = []
        system = _build_system_prompt(self.table_summary)

        for round_num in range(MAX_TOOL_ROUNDS):
            log.info("=== Round %d / %d ===", round_num + 1, MAX_TOOL_ROUNDS)
            yield {"type": "status", "text": f"Analyzing{'...' if round_num == 0 else ' (follow-up query)...'}"}

            response = self.client.messages.create(
                model=MODEL,
                max_tokens=16384,
                system=system,
                tools=TOOLS,
                messages=messages,
            )

            log.info("stop_reason=%s, blocks=%d", response.stop_reason, len(response.content))

            if response.stop_reason == "tool_use":
                tool_results = []
                for block in response.content:
                    if hasattr(block, "text") and block.text.strip():
                        yield {"type": "text", "text": block.text}
                    if block.type == "tool_use":
                        yield {
                            "type": "tool_call",
                            "tool": block.name,
                            "input": block.input,
                        }
                        result_str = self._execute_tool(block.name, block.input, artifacts)

                        result_preview = result_str[:500]
                        if len(result_str) > 500:
                            result_preview += "..."
                        yield {
                            "type": "tool_result",
                            "tool": block.name,
                            "summary": result_preview,
                        }

                        tool_results.append(
                            {
                                "type": "tool_result",
                                "tool_use_id": block.id,
                                "content": result_str,
                            }
                        )

                messages.append({"role": "assistant", "content": response.content})
                messages.append({"role": "user", "content": tool_results})

            elif response.stop_reason == "max_tokens":
                text = ""
                for block in response.content:
                    if hasattr(block, "text"):
                        text += block.text
                if text.strip():
                    yield {"type": "text", "text": text}
                log.warning("Response truncated at max_tokens, continuing...")
                messages.append({"role": "assistant", "content": response.content})
                messages.append({"role": "user", "content": "Your response was truncated. Please continue — if you were about to create a visualization, use the `sql` parameter instead of embedding data."})

            else:
                text = ""
                for block in response.content:
                    if hasattr(block, "text"):
                        text += block.text
                yield {"type": "text", "text": text}
                if artifacts:
                    yield {"type": "artifacts", "artifacts": artifacts}
                yield {"type": "done"}
                return

        last_text = ""
        if messages and messages[-1].get("role") == "user":
            prev_assistant = messages[-2] if len(messages) >= 2 else None
            if prev_assistant and prev_assistant.get("role") == "assistant":
                content = prev_assistant.get("content", [])
                if isinstance(content, list):
                    for block in content:
                        if hasattr(block, "text"):
                            last_text += block.text

        summary = last_text if last_text.strip() else "I reached the maximum number of analysis steps — feel free to ask a follow-up to dig deeper."
        yield {"type": "text", "text": summary}
        if artifacts:
            yield {"type": "artifacts", "artifacts": artifacts}
        yield {"type": "done"}
