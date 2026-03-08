"""
Step 2: Extract _Snapshot, _QueryTiming, _SqlRequestBody from
drift_debug_server_io.dart into server/server_types.dart, renaming
the leading underscores to make them public.
"""

import pathlib, re, textwrap

ROOT = pathlib.Path(r"D:\src\saropa_drift_viewer")
SRC  = ROOT / "lib" / "src" / "drift_debug_server_io.dart"
DEST = ROOT / "lib" / "src" / "server" / "server_types.dart"

original = SRC.read_text(encoding="utf-8")

# ── 1. Locate the three type blocks (lines 67-117) ──────────────────────

# _Snapshot class: line 67 through the closing brace at line 77
snap_re = re.compile(
    r"^/// In-memory snapshot.*?\n"         # doc-comment
    r"class _Snapshot \{.*?\n\}",           # class body
    re.MULTILINE | re.DOTALL,
)
snap_match = snap_re.search(original)
assert snap_match, "_Snapshot not found"

# _QueryTiming class: line 79 through closing brace at line 102
qt_re = re.compile(
    r"^/// A single query timing.*?\n"      # doc-comment
    r"class _QueryTiming \{.*?\n\}",        # class body
    re.MULTILINE | re.DOTALL,
)
qt_match = qt_re.search(original)
assert qt_match, "_QueryTiming not found"

# _SqlRequestBody extension type: line 104 through closing brace at line 117
srb_re = re.compile(
    r"^/// Validated POST /api/sql.*?\n"    # doc-comment
    r"extension type _SqlRequestBody.*?\n\}",
    re.MULTILINE | re.DOTALL,
)
srb_match = srb_re.search(original)
assert srb_match, "_SqlRequestBody not found"

print("Found _Snapshot at:", snap_match.start(), "-", snap_match.end())
print("Found _QueryTiming at:", qt_match.start(), "-", qt_match.end())
print("Found _SqlRequestBody at:", srb_match.start(), "-", srb_match.end())

# ── 2. Build the new file content ────────────────────────────────────────

snap_text = snap_match.group()
qt_text   = qt_match.group()
srb_text  = srb_match.group()

# Rename _Snapshot -> Snapshot
snap_text = snap_text.replace("class _Snapshot", "class Snapshot")
snap_text = snap_text.replace("const _Snapshot(", "const Snapshot(")
snap_text = snap_text.replace("'_Snapshot(", "'Snapshot(")

# Rename _QueryTiming -> QueryTiming
qt_text = qt_text.replace("class _QueryTiming", "class QueryTiming")
qt_text = qt_text.replace("_QueryTiming({", "QueryTiming({")

# Rename _SqlRequestBody -> SqlRequestBody
srb_text = srb_text.replace("extension type _SqlRequestBody", "extension type SqlRequestBody")
srb_text = srb_text.replace("static _SqlRequestBody?", "static SqlRequestBody?")
srb_text = srb_text.replace("return _SqlRequestBody(", "return SqlRequestBody(")
# Replace local _keySql constant with ServerConstants.jsonKeySql
srb_text = srb_text.replace("static const String _keySql = 'sql';", "")
srb_text = srb_text.replace("decoded[_keySql]", "decoded[ServerConstants.jsonKeySql]")
# Clean up any blank line left inside the body
srb_text = re.sub(r'\n\n\n+', '\n\n', srb_text)

new_file = textwrap.dedent("""\
// Helper types extracted from drift_debug_server_io.dart to reduce file size.
// See drift_debug_server_io.dart for usage.

import 'server_constants.dart';

// --- Snapshot (time-travel) ---

{snap}

{qt}

{srb}
""").format(snap=snap_text, qt=qt_text, srb=srb_text)

DEST.parent.mkdir(parents=True, exist_ok=True)
DEST.write_text(new_file, encoding="utf-8")
print(f"\nWrote {DEST}")

# ── 3. Update the original file ─────────────────────────────────────────

modified = original

# 3a. Remove the three type blocks (including blank-line spacing around them).
#     We remove from the "// --- Snapshot (time-travel) ---" comment line
#     through the closing brace of _SqlRequestBody (line 117) plus trailing blank line.
block_re = re.compile(
    r"\n// --- Snapshot \(time-travel\) ---\n\n"
    r"/// In-memory snapshot.*?"
    r"extension type _SqlRequestBody.*?\n\}\n",
    re.DOTALL,
)
block_match = block_re.search(modified)
assert block_match, "Could not find the combined block to remove"
print(f"Removing block at chars {block_match.start()}-{block_match.end()}")
modified = modified[:block_match.start()] + "\n" + modified[block_match.end():]

# 3b. Add import for server_types.dart (right after the existing server_constants import)
modified = modified.replace(
    "import 'server/server_constants.dart';",
    "import 'server/server_constants.dart';\nimport 'server/server_types.dart';",
)

# 3c. Replace all remaining references to the old private names
modified = modified.replace("_Snapshot?", "Snapshot?")
modified = modified.replace("_Snapshot(", "Snapshot(")
modified = modified.replace("List<_QueryTiming>", "List<QueryTiming>")
modified = modified.replace("_QueryTiming(", "QueryTiming(")
modified = modified.replace("_SqlRequestBody?", "SqlRequestBody?")
modified = modified.replace("_SqlRequestBody.fromJson", "SqlRequestBody.fromJson")
modified = modified.replace("({_SqlRequestBody?", "({SqlRequestBody?")

SRC.write_text(modified, encoding="utf-8")
print(f"Updated {SRC}")
print("Done.")
