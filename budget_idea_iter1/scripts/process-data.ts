import * as fs from "fs";
import * as path from "path";
import * as https from "https";

const SCRIPTS_DIR = path.join(__dirname);
const RAW_DIR = path.join(SCRIPTS_DIR, "raw");
const PUBLIC_DATA_DIR = path.join(__dirname, "..", "public", "data");

const BUDGET_URL =
  "https://seshat.datasd.org/operating_budget/budget_operating_datasd.csv";
const ACCOUNTS_URL =
  "https://seshat.datasd.org/accounts_city_budget/budget_reference_accounts_datasd.csv";

const BUDGET_FILE = path.join(RAW_DIR, "budget_operating_datasd.csv");
const ACCOUNTS_FILE = path.join(
  RAW_DIR,
  "budget_reference_accounts_datasd.csv"
);

// ---------------------------------------------------------------------------
// CSV Parser – handles quoted fields with embedded commas/newlines
// ---------------------------------------------------------------------------

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const row: string[] = [];
    while (i < len) {
      if (text[i] === '"') {
        // quoted field
        i++; // skip opening quote
        let field = "";
        while (i < len) {
          if (text[i] === '"') {
            if (i + 1 < len && text[i + 1] === '"') {
              field += '"';
              i += 2;
            } else {
              i++; // skip closing quote
              break;
            }
          } else {
            field += text[i];
            i++;
          }
        }
        row.push(field);
      } else if (text[i] === "," || text[i] === "\n" || text[i] === "\r") {
        // empty or end-of-field handled below
        row.push("");
      } else {
        // unquoted field
        let field = "";
        while (i < len && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") {
          field += text[i];
          i++;
        }
        row.push(field);
      }

      if (i < len && text[i] === ",") {
        i++; // skip comma, continue row
      } else {
        // end of row
        break;
      }
    }
    // skip line endings
    while (i < len && (text[i] === "\r" || text[i] === "\n")) {
      i++;
    }
    if (row.length > 1 || (row.length === 1 && row[0] !== "")) {
      rows.push(row);
    }
  }
  return rows;
}

function rowsToObjects(rows: string[][]): Record<string, string>[] {
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (row[idx] ?? "").trim();
    });
    return obj;
  });
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) {
      console.log(`  cached: ${dest}`);
      return resolve();
    }
    console.log(`  downloading: ${url}`);
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          // follow redirect
          file.close();
          fs.unlinkSync(dest);
          download(res.headers.location!, dest).then(resolve, reject);
          return;
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      })
      .on("error", (err) => {
        fs.unlinkSync(dest);
        reject(err);
      });
  });
}

// ---------------------------------------------------------------------------
// Tree-building types
// ---------------------------------------------------------------------------

interface TreeNode {
  name: string;
  value: number;
  fund_type?: string;
  children?: TreeNode[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // 1. Ensure directories
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.mkdirSync(PUBLIC_DATA_DIR, { recursive: true });

  // 2. Download CSVs
  console.log("Downloading data...");
  await download(BUDGET_URL, BUDGET_FILE);
  await download(ACCOUNTS_URL, ACCOUNTS_FILE);

  // 3. Parse CSVs
  console.log("Parsing CSVs...");
  const budgetText = fs.readFileSync(BUDGET_FILE, "utf-8");
  const accountsText = fs.readFileSync(ACCOUNTS_FILE, "utf-8");

  const budgetRows = rowsToObjects(parseCSV(budgetText));
  const accountRows = rowsToObjects(parseCSV(accountsText));

  console.log(`  Budget rows: ${budgetRows.length}`);
  console.log(`  Account rows: ${accountRows.length}`);

  // 4. Filter to FY26 expenses (account_number starts with "5")
  const fy26Expenses = budgetRows.filter(
    (r) => r.report_fy === "26" && r.account_number.startsWith("5")
  );
  console.log(`  FY26 expense rows: ${fy26Expenses.length}`);

  // 5. Build account lookup
  const accountLookup: Record<string, Record<string, string>> = {};
  for (const a of accountRows) {
    accountLookup[a.account_number] = a;
  }

  // 6. Aggregate into tree
  // Dept → account_type → account_class → value
  const deptMap: Record<
    string,
    {
      fundTypeCounts: Record<string, number>;
      classes: Record<string, Record<string, number>>; // account_type → account_class → value
    }
  > = {};

  for (const row of fy26Expenses) {
    const dept = row.dept_name || "Unknown";
    const amount = parseFloat(row.amount) || 0;
    const acctRef = accountLookup[row.account_number];
    const accountType = acctRef?.account_type || "Other";
    const accountClass = acctRef?.account_class || "Other";
    const fundType = row.fund_type || "Other";

    if (!deptMap[dept]) {
      deptMap[dept] = { fundTypeCounts: {}, classes: {} };
    }
    const d = deptMap[dept];
    d.fundTypeCounts[fundType] = (d.fundTypeCounts[fundType] || 0) + 1;

    if (!d.classes[accountType]) {
      d.classes[accountType] = {};
    }
    d.classes[accountType][accountClass] =
      (d.classes[accountType][accountClass] || 0) + amount;
  }

  // Build tree
  const root: TreeNode = {
    name: "City of San Diego FY2026 Budget",
    value: 0,
    children: [],
  };

  for (const [deptName, deptData] of Object.entries(deptMap)) {
    // Most common fund_type
    const mostCommonFundType = Object.entries(deptData.fundTypeCounts).sort(
      (a, b) => b[1] - a[1]
    )[0][0];

    const deptNode: TreeNode = {
      name: deptName,
      value: 0,
      fund_type: mostCommonFundType,
      children: [],
    };

    for (const [typeName, classes] of Object.entries(deptData.classes)) {
      const typeNode: TreeNode = {
        name: typeName,
        value: 0,
        children: [],
      };

      for (const [className, classValue] of Object.entries(classes)) {
        const val = Math.round(classValue);
        typeNode.children!.push({ name: className, value: val });
        typeNode.value += val;
      }

      // Sort children by value descending
      typeNode.children!.sort((a, b) => b.value - a.value);
      deptNode.children!.push(typeNode);
      deptNode.value += typeNode.value;
    }

    // Sort account types by value descending
    deptNode.children!.sort((a, b) => b.value - a.value);
    root.children!.push(deptNode);
    root.value += deptNode.value;
  }

  // Sort departments by value descending
  root.children!.sort((a, b) => b.value - a.value);

  // 7. Write output
  const outPath = path.join(PUBLIC_DATA_DIR, "budget_tree.json");
  fs.writeFileSync(outPath, JSON.stringify(root, null, 2));
  console.log(`\nWrote ${outPath}`);
  console.log(`  Total departments: ${root.children!.length}`);
  console.log(`  Total budget value: $${root.value.toLocaleString()}`);

  // =========================================================================
  // 8. Parse council meeting data
  // =========================================================================
  console.log("\nParsing council meeting data...");

  const COUNCIL_FILE = path.join(__dirname, "..", "council_meetings_raw.txt");
  const councilRaw = fs.readFileSync(COUNCIL_FILE, "utf-8");

  // Budget-related keywords
  const BUDGET_KEYWORDS = [
    "budget", "fund", "appropriat", "financ", "revenue", "contract", "fee",
    "capital", "cost", "expend", "allocat", "grant", "bond", "tax", "water",
    "sewer", "police", "fire", "park", "library", "transit", "housing",
    "infrastructure", "construction", "maintenance", "procurement", "lease",
    "settlement",
  ];

  // Department names from the budget tree
  const DEPT_NAMES = root.children!.map((c) => c.name);

  interface CouncilItem {
    meetingId: string;
    meetingDate: string;
    itemId: string;
    title: string;
    vote: string;
    resolution: string;
    relatedDepts: string[];
    subcategory: string;
  }

  // Subcategory classification based on title keywords
  // These match the account_class values in budget_tree.json
  const SUBCATEGORY_RULES: { pattern: RegExp; category: string }[] = [
    // Personnel
    { pattern: /\b(position|classification|classified service|hiring|wages|salary|salaried|employee appreciation|employee .* month|representation unit|job classification|labor agreement|union|AFSCME|overtime compensation)/i, category: "Personnel Cost" },
    { pattern: /\b(benefit|pension|retire|workers.?comp|flexible benefit)/i, category: "Fringe Benefits" },
    // Capital
    { pattern: /\b(construction contract|capital improve|CIP|infrastructure improv|roadway improv|pipeline|sewer.*(group|replace)|water.*(group|replace)|storm drain|underground utility)/i, category: "Capital Expenditures" },
    // IT
    { pattern: /\b(software|SaaS|microsoft|dell marketing|information system|technology system|point.of.sale|electronic filing|digital|cyber)/i, category: "Information Technology" },
    // Debt
    { pattern: /\b(revenue bond|lease revenue bond|refunding bond|financing authority|debt)/i, category: "Debt" },
    // Transfers / Grants
    { pattern: /\b(grant fund|accept and expend|community projects.*programs.*services|funding allocat|nonprofit)/i, category: "Transfers Out" },
    // Supplies / Equipment
    { pattern: /\b(purchase of|vehicle|automobile|SUV|van|truck|chassis|equipment|safety shoes|crack seal|asphalt|calcium nitrate|bioxide)/i, category: "Supplies" },
    // Energy
    { pattern: /\b(energy|solar panel|utility rate|water.*rate|wastewater.*rate)/i, category: "Energy and Utilities" },
    // Contracts & Services (broadest — check last)
    { pattern: /\b(contract|agreement|amendment.*contract|amendment.*agreement|consulting|consultant|legal service|outside counsel|settlement|lease(?!.*revenue bond)|RFP|procurement|bid|award)/i, category: "Contracts & Services" },
  ];

  const councilItems: CouncilItem[] = [];

  // Split by meeting delimiter
  const meetingChunks = councilRaw.split(/===MEETING_/).filter((s) => s.trim());

  for (const chunk of meetingChunks) {
    // Extract meeting ID
    const idMatch = chunk.match(/^(\d+)===/);
    if (!idMatch) continue;
    const meetingId = idMatch[1];

    // Split into ITEMS and RESULTS sections
    const itemsSplit = chunk.split("---ITEMS---");
    if (itemsSplit.length < 2) continue;
    const afterItems = itemsSplit[1];
    const resultsSplit = afterItems.split("---RESULTS---");
    const itemsSection = resultsSplit[0];
    const resultsSection = resultsSplit.length > 1 ? resultsSplit[1] : "";

    // Extract date from results section
    const dateMatch = resultsSection.match(/DATE:\s*([A-Z]+,\s*[A-Z]+\s+\d+,\s*\d{4})/);
    const meetingDate = dateMatch ? dateMatch[1] : "";

    // Parse items: extract ITEMID/ITEM pairs
    const lines = itemsSection.split("\n");
    let currentItemId = "";
    const itemPairs: { itemId: string; title: string }[] = [];

    for (const line of lines) {
      const idLine = line.match(/^ITEMID:\s*(\d+)/);
      if (idLine) {
        currentItemId = idLine[1];
        continue;
      }
      const itemLine = line.match(/^ITEM:\s*(.+)/);
      if (itemLine && currentItemId) {
        itemPairs.push({ itemId: currentItemId, title: itemLine[1].trim() });
        currentItemId = "";
      }
    }

    // Process each item
    for (const { itemId, title } of itemPairs) {
      // Check if budget-related
      const titleLower = title.toLowerCase();
      const isBudgetRelated = BUDGET_KEYWORDS.some((kw) =>
        titleLower.includes(kw)
      );
      if (!isBudgetRelated) continue;

      // Match to departments using distinctive words from dept names
      const GENERIC_WORDS = new Set([
        "city", "services", "service", "department", "office", "council",
        "district", "special", "fund", "funds", "management", "other",
        "general", "commission", "programs", "strategies", "solutions",
        "information", "real", "estate", "practices", "events",
        "operating", "assistant", "chief", "officer",
      ]);

      // Topic-based matching: map keywords in titles to likely departments
      const TOPIC_DEPT_MAP: Record<string, string[]> = {
        "water": ["Public Utilities"],
        "wastewater": ["Public Utilities"],
        "sewer": ["Public Utilities"],
        "pure water": ["Public Utilities"],
        "stormwater": ["Stormwater"],
        "storm drain": ["Stormwater"],
        "police": ["Police"],
        "sdpd": ["Police"],
        "public safety": ["Police"],
        "military equipment": ["Police"],
        "fire": ["Fire-Rescue"],
        "ems": ["Emergency Medical Services"],
        "paramedic": ["Emergency Medical Services"],
        "airport": ["Real Estate & Airport Management"],
        "montgomery-gibbs": ["Real Estate & Airport Management"],
        "park": ["Parks & Recreation"],
        "recreation": ["Parks & Recreation"],
        "golf": ["Parks & Recreation"],
        "library": ["Library"],
        "housing": ["City Planning"],
        "zoning": ["City Planning"],
        "community plan": ["City Planning"],
        "land development": ["City Planning"],
        "permit": ["Development Services"],
        "building code": ["Development Services"],
        "fire code": ["Development Services"],
        "street": ["Transportation"],
        "traffic": ["Transportation"],
        "road": ["Transportation"],
        "sidewalk": ["Transportation"],
        "transit": ["Transportation"],
        "bicycle": ["Transportation"],
        "bridge": ["Engineering & Capital Projects"],
        "construction contract": ["Engineering & Capital Projects"],
        "cip": ["Engineering & Capital Projects"],
        "technology": ["Department of Information Technology"],
        "software": ["Department of Information Technology"],
        "microsoft": ["Department of Information Technology"],
        "dell marketing": ["Department of Information Technology"],
        "it ": ["Department of Information Technology"],
        "environmental": ["Environmental Services"],
        "recycling": ["Environmental Services"],
        "waste": ["Environmental Services"],
        "settlement": ["City Attorney"],
        "litigation": ["City Attorney"],
        "legal": ["City Attorney"],
        "outside counsel": ["City Attorney"],
        "ballot": ["City Clerk"],
        "election": ["City Clerk"],
        "minutes": ["City Clerk"],
        "budget": ["Office of the Mayor"],
        "fiscal year": ["Office of the Mayor"],
        "nonprofit": ["Council Administration"],
        "community projects": ["Council Administration"],
      };

      const relatedDepts: string[] = [];

      // First try topic-based matching (more reliable)
      for (const [keyword, depts] of Object.entries(TOPIC_DEPT_MAP)) {
        if (titleLower.includes(keyword)) {
          for (const dept of depts) {
            if (!relatedDepts.includes(dept)) {
              relatedDepts.push(dept);
            }
          }
        }
      }

      // Then try department name word matching
      if (relatedDepts.length === 0) {
        for (const dept of DEPT_NAMES) {
          const words = dept
            .split(/[\s&,]+/)
            .filter((w) => w.length > 3 && !GENERIC_WORDS.has(w.toLowerCase()));
          if (words.length === 0) continue;
          const matched = words.some((w) => {
            const wLower = w.toLowerCase();
            const regex = new RegExp(`\\b${wLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
            return regex.test(title);
          });
          if (matched) {
            relatedDepts.push(dept);
          }
        }
      }

      // Only use "Citywide" if truly no match found
      if (relatedDepts.length === 0) {
        relatedDepts.push("Citywide");
      }

      // Extract vote from results section
      // Build some key words from the title to locate the vote nearby
      let vote = "";
      let resolution = "";

      // Try to find a resolution number (R-20xx-xxx or O-20xx-xxx)
      // Search results for keywords from this item
      const titleWords = title
        .split(/\s+/)
        .filter((w) => w.length > 4)
        .map((w) => w.replace(/[^a-zA-Z0-9]/g, ""))
        .filter((w) => w.length > 4)
        .slice(0, 3);

      if (titleWords.length > 0 && resultsSection) {
        // Find the area in results containing key words from the title
        const resultsLower = resultsSection.toLowerCase();
        let searchPos = -1;
        for (const tw of titleWords) {
          const pos = resultsLower.indexOf(tw.toLowerCase());
          if (pos !== -1) {
            searchPos = pos;
            break;
          }
        }

        if (searchPos !== -1) {
          // Look for vote pattern near this position (within 500 chars)
          const neighborhood = resultsSection.substring(
            Math.max(0, searchPos - 200),
            Math.min(resultsSection.length, searchPos + 500)
          );

          // Vote patterns like "Unanimous; 7-not present" or "1234689-yea; 5-nay"
          const voteMatch = neighborhood.match(
            /(Unanimous(?:;\s*[\d]+-not present)?|[\d]+-yea(?:;\s*[\d]+-nay)?(?:;\s*[\d]+-not present)?)/
          );
          if (voteMatch) {
            vote = voteMatch[1];
          }

          // Resolution pattern like R-2026-49 or O-2026-26
          const resMatch = neighborhood.match(
            /([RO]-\d{4}-\d+(?:\s*Cor\.\s*Copy(?:\s*\d+)?)?)/
          );
          if (resMatch) {
            resolution = resMatch[1];
          }
        }
      }

      // Classify into budget subcategory
      let subcategory = "General";
      for (const rule of SUBCATEGORY_RULES) {
        if (rule.pattern.test(title)) {
          subcategory = rule.category;
          break;
        }
      }

      councilItems.push({
        meetingId,
        meetingDate,
        itemId,
        title,
        vote,
        resolution,
        relatedDepts,
        subcategory,
      });
    }
  }

  // Post-process: tag budget-wide authorizing items to ALL departments
  const BUDGET_WIDE_PATTERNS = [
    /Appropriation Ordinance/i,
    /Budget Monitoring Report/i,
  ];

  for (const item of councilItems) {
    const isBudgetWide = BUDGET_WIDE_PATTERNS.some((p) => p.test(item.title));
    if (isBudgetWide) {
      // Tag to all departments instead of just Office of the Mayor
      item.relatedDepts = [...DEPT_NAMES];
      // The Appropriation Ordinance is the bill that authorizes all dept spending/staffing
      if (/Appropriation Ordinance/i.test(item.title)) {
        item.subcategory = "Personnel Cost";
      }
    }
  }

  // Write council items
  const councilOutPath = path.join(PUBLIC_DATA_DIR, "council_items.json");
  fs.writeFileSync(councilOutPath, JSON.stringify(councilItems, null, 2));
  console.log(`\nWrote ${councilOutPath}`);
  console.log(`  Total council items: ${councilItems.length}`);
  console.log(
    `  Meetings covered: ${new Set(councilItems.map((i) => i.meetingId)).size}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
