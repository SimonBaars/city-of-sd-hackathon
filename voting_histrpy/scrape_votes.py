#!/usr/bin/env python3
"""
San Diego City Council Vote Scraper

Scrapes voting records from the Hyland Cloud system used by the SD City Clerk.
Outputs structured JSON with per-member vote details for each agenda item.

Data source: sandiego.hylandcloud.com/211agendaonlinecouncil
"""

import json
import re
import sys
import time
from datetime import datetime

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://sandiego.hylandcloud.com/211agendaonlinecouncil/Documents/ViewAgenda"

# District-to-council-member mapping for 2025-2026 term
DISTRICT_MAP = {
    "1": "Joe LaCava",
    "2": "Jennifer Campbell",
    "3": "Stephen Whitburn",
    "4": "Henry Foster III",
    "5": "Marni von Wilpert",
    "6": "Kent Lee",
    "7": "Raul Campillo",
    "8": "Vivian Moreno",
    "9": "Sean Elo-Rivera",
}

ALL_DISTRICTS = set(DISTRICT_MAP.keys())

# Known meeting IDs with valid result summaries (discovered via scan)
MEETING_IDS = [
    # January 2025
    6378, 6379,
    # February 2025
    6384, 6391, 6392, 6398, 6402, 6424,
    # March 2025
    6428, 6429, 6442, 6443, 6444, 6451, 6456, 6457,
    # April 2025
    6471, 6472, 6481, 6483, 6488,
    # May 2025
    6503, 6504, 6509, 6510,
    # June 2025
    6531, 6532, 6538, 6539, 6548, 6554, 6555, 6572, 6573, 6592, 6593,
    # July 2025
    6611, 6612, 6616, 6617, 6627, 6628,
    # September 2025
    6665, 6666, 6675, 6676, 6680, 6689, 6690,
    # October 2025
    6695, 6696, 6714, 6715, 6728, 6729,
    # November 2025
    6738, 6739, 6748, 6751,
    # December 2025
    6780, 6781, 6782, 6783, 6784,
    # January 2026
    6804, 6805, 6827, 6828,
    # February 2026
    6842, 6850, 6853, 6869, 6870,
    # March 2026
    6880, 6881,
]


def parse_vote_string(vote_str: str) -> dict:
    """Parse a vote string like '1234679-yea; 8-nay; 5-not present' into per-member votes.

    Returns dict with keys: votes (dict of name->vote), unanimous (bool), raw (str)
    """
    vote_str = vote_str.strip()
    # Remove trailing notes like "* See motion below:"
    vote_str = re.sub(r'\*.*$', '', vote_str).strip()
    # Remove parenthetical procedural notes
    vote_str = re.sub(r'\(Motion to.*$', '', vote_str, flags=re.DOTALL).strip()

    result = {"votes": {}, "unanimous": False, "raw": vote_str}

    if not vote_str:
        return result

    # Handle "Unanimous" votes
    if "Unanimous" in vote_str or "unanimous" in vote_str:
        result["unanimous"] = True
        # Find who was absent
        absent = set()
        not_present_match = re.search(r'(\d+)-not present', vote_str)
        if not_present_match:
            absent = set(not_present_match.group(1))

        present_match = re.search(r'all present', vote_str, re.IGNORECASE)
        if present_match:
            absent = set()

        for d in ALL_DISTRICTS:
            name = DISTRICT_MAP[d]
            if d in absent:
                result["votes"][name] = "absent"
            else:
                result["votes"][name] = "yea"
        return result

    # Parse explicit vote patterns like "1234679-yea; 8-nay; 5-not present"
    # Also handles "123567-yea;489-nay" (no spaces)
    segments = re.split(r';\s*', vote_str)
    accounted = set()

    for segment in segments:
        segment = segment.strip()
        if not segment:
            continue

        # Match patterns like "1234679-yea" or "8-nay" or "5-not present"
        match = re.match(r'^(\d+)\s*-\s*(yea|nay|abstain|not present|absent|recused)$', segment, re.IGNORECASE)
        if match:
            districts = set(match.group(1))
            vote_type = match.group(2).lower()
            if vote_type == "not present":
                vote_type = "absent"
            for d in districts:
                if d in DISTRICT_MAP:
                    result["votes"][DISTRICT_MAP[d]] = vote_type
                    accounted.add(d)
            continue

        # Try matching just district numbers without clear label (fallback)
        match2 = re.match(r'^(\d+)$', segment)
        if match2:
            # Standalone numbers without label - skip
            continue

    # Any unaccounted districts - mark as unknown
    for d in ALL_DISTRICTS - accounted:
        if DISTRICT_MAP[d] not in result["votes"]:
            result["votes"][DISTRICT_MAP[d]] = "unknown"

    return result


def parse_meeting_date(header_text: str) -> str:
    """Extract meeting date from header text. Returns ISO date string."""
    # Match patterns like "TUESDAY, DECEMBER 9, 2025"
    match = re.search(
        r'(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY),?\s+'
        r'(\w+\s+\d{1,2},?\s+\d{4})',
        header_text, re.IGNORECASE
    )
    if match:
        date_str = match.group(2).replace(',', '')
        try:
            dt = datetime.strptime(date_str.strip(), "%B %d %Y")
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            pass
    return ""


def parse_action_text(action_text: str) -> dict:
    """Parse action cell text into action type and description."""
    action_text = action_text.strip()

    # Try to split action from description
    # Patterns: "Approved Proclaiming...", "Adopted (R-2026-174) Authorizing...",
    #           "Introduced (O-2026-46) Authorizing..."
    match = re.match(
        r'^(Approved|Adopted|Introduced|Denied|Withdrawn|Continued|Filed|'
        r'Adopted as Amended|Procedural Action|No Action Taken|Tabled|Referred)'
        r'(?:\s*\(([^)]+)\))?\s*(.*)',
        action_text, re.IGNORECASE | re.DOTALL
    )
    if match:
        return {
            "action": match.group(1).strip(),
            "reference": match.group(2).strip() if match.group(2) else "",
            "description": match.group(3).strip(),
        }

    return {
        "action": "",
        "reference": "",
        "description": action_text,
    }


def scrape_meeting(meeting_id: int) -> dict | None:
    """Scrape a single meeting's result summary. Returns parsed meeting data or None."""
    url = f"{BASE_URL}?meetingId={meeting_id}&type=summary&doctype=3"

    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"  ERROR fetching {meeting_id}: {e}", file=sys.stderr)
        return None

    if "Document unavailable" in resp.text:
        return None
    if "CITY COUNCIL MEETING RESULTS SUMMARY" not in resp.text:
        return None

    soup = BeautifulSoup(resp.text, "html.parser")
    rows = soup.find_all("tr")

    if not rows:
        return None

    # Extract date from first row (header)
    header_text = rows[0].get_text(strip=True)
    meeting_date = parse_meeting_date(header_text)

    if not meeting_date:
        print(f"  WARNING: Could not parse date for meeting {meeting_id}", file=sys.stderr)
        return None

    # Determine day of week from header
    day_match = re.search(r'(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)', header_text, re.IGNORECASE)
    day_of_week = day_match.group(1).title() if day_match else ""

    # Parse vote items from data rows (skip header rows)
    items = []
    for row in rows[2:]:  # Skip header row and column header row
        cells = row.find_all("td")
        if len(cells) != 6:
            continue

        item_no = cells[0].get_text(strip=True)
        action_text = cells[1].get_text(strip=True)
        motion_second = cells[4].get_text(strip=True)
        vote_text = cells[5].get_text(strip=True)

        # Skip non-item rows (section headers, procedural notes without votes)
        if not item_no or not vote_text:
            continue
        # Skip rows that are clearly not vote items
        if item_no in ("ITEMNO.", "O", "I", "R"):
            continue

        action = parse_action_text(action_text)
        vote_data = parse_vote_string(vote_text)

        # Parse motion/second
        motion_by = ""
        second_by = ""
        ms_match = re.match(r'^(\d)/(\d)$', motion_second)
        if ms_match:
            d1, d2 = ms_match.group(1), ms_match.group(2)
            motion_by = DISTRICT_MAP.get(d1, f"District {d1}")
            second_by = DISTRICT_MAP.get(d2, f"District {d2}")

        items.append({
            "item_number": item_no,
            "action": action["action"],
            "reference": action["reference"],
            "description": action["description"],
            "motion_by": motion_by,
            "second_by": second_by,
            "unanimous": vote_data["unanimous"],
            "votes": vote_data["votes"],
            "vote_raw": vote_data["raw"],
        })

    if not items:
        return None

    return {
        "meeting_id": meeting_id,
        "date": meeting_date,
        "day_of_week": day_of_week,
        "source_url": url,
        "items": items,
    }


def main():
    print(f"Scraping {len(MEETING_IDS)} meetings...", file=sys.stderr)

    all_meetings = []
    for i, mid in enumerate(MEETING_IDS):
        print(f"  [{i+1}/{len(MEETING_IDS)}] Meeting ID {mid}...", file=sys.stderr)
        meeting = scrape_meeting(mid)
        if meeting:
            print(f"    -> {meeting['date']} ({meeting['day_of_week']}): {len(meeting['items'])} items", file=sys.stderr)
            all_meetings.append(meeting)
        else:
            print(f"    -> skipped (no valid data)", file=sys.stderr)

        # Be polite to the server
        time.sleep(0.5)

    # Sort by date
    all_meetings.sort(key=lambda m: m["date"])

    # Summary stats
    total_items = sum(len(m["items"]) for m in all_meetings)
    split_votes = sum(
        1 for m in all_meetings for item in m["items"]
        if not item["unanimous"]
    )

    output = {
        "metadata": {
            "description": "San Diego City Council Voting History",
            "date_range": {
                "start": all_meetings[0]["date"] if all_meetings else "",
                "end": all_meetings[-1]["date"] if all_meetings else "",
            },
            "total_meetings": len(all_meetings),
            "total_vote_items": total_items,
            "split_votes": split_votes,
            "council_members": DISTRICT_MAP,
            "scraped_at": datetime.now().isoformat(),
            "source": "sandiego.hylandcloud.com/211agendaonlinecouncil",
        },
        "meetings": all_meetings,
    }

    print(json.dumps(output, indent=2, ensure_ascii=False))
    print(f"\nDone: {len(all_meetings)} meetings, {total_items} vote items, {split_votes} split votes", file=sys.stderr)


if __name__ == "__main__":
    main()
