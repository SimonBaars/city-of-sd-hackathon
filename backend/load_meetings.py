#!/usr/bin/env python3
"""Load correlation_analysis.json (council meeting transcript analysis) into DuckDB."""

import json
from pathlib import Path

import duckdb

DB_PATH = Path(__file__).parent / "san_diego.duckdb"
JSON_PATH = Path(__file__).parent.parent / "correlation_analysis.json"


def load_meetings():
    data = json.loads(JSON_PATH.read_text())
    con = duckdb.connect(str(DB_PATH))

    con.execute("DROP TABLE IF EXISTS meeting_sessions")
    con.execute("DROP TABLE IF EXISTS meeting_docket_items")
    con.execute("DROP TABLE IF EXISTS meeting_discussion_points")
    con.execute("DROP TABLE IF EXISTS meeting_transcript_items")
    con.execute("DROP TABLE IF EXISTS meeting_public_comments")

    con.execute("""
        CREATE TABLE meeting_sessions (
            date DATE PRIMARY KEY,
            duration_seconds DOUBLE,
            duration_formatted VARCHAR,
            docket_file VARCHAR,
            num_docket_items INTEGER,
            num_transcript_items INTEGER,
            num_public_comments INTEGER
        )
    """)

    con.execute("""
        CREATE TABLE meeting_docket_items (
            id INTEGER PRIMARY KEY,
            date DATE,
            item_letter VARCHAR,
            title VARCHAR,
            staff VARCHAR,
            discussed_in_transcript BOOLEAN,
            keyword_matches INTEGER,
            matched_phrases VARCHAR,
            discussion_found BOOLEAN
        )
    """)

    con.execute("""
        CREATE TABLE meeting_discussion_points (
            id INTEGER PRIMARY KEY,
            docket_item_id INTEGER,
            date DATE,
            item_letter VARCHAR,
            point TEXT,
            speaker INTEGER,
            timestamp_seconds DOUBLE,
            timestamp VARCHAR,
            relevance_score INTEGER
        )
    """)

    con.execute("""
        CREATE TABLE meeting_transcript_items (
            id INTEGER PRIMARY KEY,
            date DATE,
            item_id VARCHAR,
            category VARCHAR,
            context_excerpt TEXT,
            in_docket BOOLEAN,
            discussed_in_transcript BOOLEAN,
            discussion_mentions INTEGER,
            estimated_discussion_seconds DOUBLE,
            estimated_discussion_time VARCHAR,
            outcome VARCHAR
        )
    """)

    con.execute("""
        CREATE TABLE meeting_public_comments (
            id INTEGER PRIMARY KEY,
            date DATE,
            section_label VARCHAR,
            timestamp_seconds DOUBLE,
            timestamp VARCHAR,
            duration_seconds DOUBLE,
            num_speakers INTEGER,
            speaker_ids VARCHAR
        )
    """)

    session_rows = []
    docket_rows = []
    discussion_rows = []
    transcript_rows = []
    comment_rows = []
    docket_id = 0
    disc_id = 0
    trans_id = 0
    comment_id = 0

    for meeting in data["meetings"]:
        date = meeting["date"]
        pc = meeting.get("public_comments", [])

        session_rows.append((
            date,
            meeting.get("meeting_duration_seconds"),
            meeting.get("meeting_duration"),
            meeting.get("docket_file"),
            len(meeting.get("docket_items", [])),
            len(meeting.get("transcript_items", [])),
            len(pc),
        ))

        for item in meeting.get("docket_items", []):
            docket_id += 1
            docket_rows.append((
                docket_id,
                date,
                item.get("item_letter"),
                item.get("title"),
                item.get("staff"),
                item.get("discussed_in_transcript"),
                item.get("keyword_matches"),
                ", ".join(item.get("matched_phrases", [])),
                item.get("discussion_found"),
            ))
            for dp in item.get("key_discussion_points", []):
                disc_id += 1
                discussion_rows.append((
                    disc_id,
                    docket_id,
                    date,
                    item.get("item_letter"),
                    dp.get("point"),
                    dp.get("speaker"),
                    dp.get("timestamp_seconds"),
                    dp.get("timestamp"),
                    dp.get("relevance_score"),
                ))

        for ti in meeting.get("transcript_items", []):
            trans_id += 1
            transcript_rows.append((
                trans_id,
                date,
                ti.get("item_id"),
                ti.get("category"),
                ti.get("context_excerpt"),
                ti.get("in_docket"),
                ti.get("discussed_in_transcript"),
                ti.get("discussion_mentions"),
                ti.get("estimated_discussion_seconds"),
                ti.get("estimated_discussion_time"),
                ti.get("outcome"),
            ))

        for pc_item in pc:
            comment_id += 1
            comment_rows.append((
                comment_id,
                date,
                pc_item.get("section_label"),
                pc_item.get("timestamp_seconds"),
                pc_item.get("timestamp"),
                pc_item.get("duration_seconds"),
                pc_item.get("num_speakers"),
                ", ".join(str(s) for s in pc_item.get("speaker_ids", [])),
            ))

    for sql, rows in [
        ("INSERT INTO meeting_sessions VALUES (?, ?, ?, ?, ?, ?, ?)", session_rows),
        ("INSERT INTO meeting_docket_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", docket_rows),
        ("INSERT INTO meeting_discussion_points VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", discussion_rows),
        ("INSERT INTO meeting_transcript_items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", transcript_rows),
        ("INSERT INTO meeting_public_comments VALUES (?, ?, ?, ?, ?, ?, ?, ?)", comment_rows),
    ]:
        if rows:
            con.executemany(sql, rows)

    for tname in ["meeting_sessions", "meeting_docket_items", "meeting_discussion_points",
                   "meeting_transcript_items", "meeting_public_comments"]:
        cnt = con.execute(f"SELECT count(*) FROM {tname}").fetchone()[0]
        cols = [r[1] for r in con.execute(f"PRAGMA table_info('{tname}')").fetchall()]
        con.execute(
            "INSERT OR REPLACE INTO _metadata VALUES (?, ?, ?, ?, ?, ?)",
            [tname, "council-meeting-analysis", f"{tname}.json", cnt, json.dumps(cols), False]
        )
        print(f"  {tname}: {cnt} rows")

    con.close()
    print("Done loading meeting analysis data.")


if __name__ == "__main__":
    load_meetings()
