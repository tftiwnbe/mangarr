import json
import re
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse
import requests

# --------------------------
# CONFIG
# --------------------------
url = "https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json"
DAYS = 3  # Look back N days
PATH = "apk"  # Folder to track
token = None  # Optional: GitHub token for higher rate limits
# --------------------------

# Step 1: Extract OWNER, REPO, BRANCH from URL
parsed = urlparse(url)
parts = parsed.path.strip("/").split("/")
OWNER = parts[0]
REPO = parts[1]
BRANCH = parts[2]

# Step 2: GitHub API headers
headers = {"Accept": "application/vnd.github+json"}
if token:
    headers["Authorization"] = f"Bearer {token}"

# Step 3: Time filter (timezone-aware UTC)
since = (datetime.now(timezone.utc) - timedelta(days=DAYS)).isoformat()
print(f"Fetching commits from {OWNER}/{REPO}, branch {BRANCH}, since {since}...")


# --------------------------
# Helpers
# --------------------------
def days_ago(commit_day_str):
    """Convert YYYY-MM-DD to 'X days ago'."""
    commit_date = datetime.strptime(commit_day_str, "%Y-%m-%d").replace(
        tzinfo=timezone.utc
    )
    now = datetime.now(timezone.utc)
    delta = now - commit_date
    days = delta.days
    if days == 0:
        return "today"
    elif days == 1:
        return "1 day ago"
    else:
        return f"{days} days ago"


def parse_name_version(filename):
    """Extract full name and version from a filename like 'apk/tachiyomi-en.meitoon-v1.4.18.apk'"""
    base = filename.split("/")[-1]
    match = re.match(r"(.+?)(?:-v([\d.]+))?\.apk$", base)
    if match:
        return match.groups()  # returns (full_name, version)
    return base, None


def extract_lang_app(full_name):
    """
    From 'tachiyomi-en.meitoon' return lang='en', name='meitoon'
    From 'tachiyomi-ja.comicgrast' return lang='ja', name='comicgrast'
    """
    match = re.match(r".+-(\w+)\.(.+)$", full_name)
    if match:
        lang, name = match.groups()
        return lang, name
    return None, full_name


# --------------------------
# Step 4: Get commits touching the folder
# --------------------------
commits_url = f"https://api.github.com/repos/{OWNER}/{REPO}/commits"
params = {"path": PATH, "since": since, "sha": BRANCH}
resp = requests.get(commits_url, headers=headers, params=params)
resp.raise_for_status()
commits = resp.json()
print(f"Found {len(commits)} commits touching '{PATH}'.")


# --------------------------
# Step 5: Collect file changes
# --------------------------
changes = []
for i, commit in enumerate(commits, start=1):
    sha = commit["sha"]
    commit_url = f"https://api.github.com/repos/{OWNER}/{REPO}/commits/{sha}"
    cr = requests.get(commit_url, headers=headers)
    cr.raise_for_status()
    cdata = cr.json()
    commit_day = cdata["commit"]["committer"]["date"][:10]  # YYYY-MM-DD
    commit_day_human = days_ago(commit_day)

    print(f"[{i}/{len(commits)}] Processing commit {sha} ({commit_day})")

    for f in cdata.get("files", []):
        filename = f["filename"]
        if not filename.startswith(PATH + "/"):
            continue

        status = f["status"]
        full_name, version = parse_name_version(filename)
        lang, app_name = extract_lang_app(full_name)

        entry = {
            "status": status,
            "commit_day": commit_day_human,  # human-readable
            "name": app_name,
            "lang": lang,
            "version": version,
        }

        if status == "renamed":
            prev = f.get("previous_filename")
            prev_full_name, prev_version = parse_name_version(prev)
            prev_lang, prev_app_name = extract_lang_app(prev_full_name)

            if prev_app_name == app_name:
                # Only version changed → mark as updated
                entry["status"] = "updated"
                entry["name"] = app_name
                entry["lang"] = lang
                entry["version"] = prev_version
                if version != prev_version:
                    entry["new_version"] = version
                print(f"  Updated (version change): {prev_full_name} -> {full_name}")
            else:
                # True rename
                entry["name"] = prev_app_name
                entry["lang"] = prev_lang
                entry["renamed_to"] = app_name
                entry["version"] = prev_version
                if version != prev_version:
                    entry["new_version"] = version
                print(f"  Renamed: {prev_full_name} -> {full_name}")
        else:
            print(f"  {status.capitalize()}: {full_name}")

        changes.append(entry)


# --------------------------
# Step 6: Post-process updates (merge added/removed into updated if needed)
# --------------------------
final_changes = []
updates = {}

for c in changes:
    if c["status"] in ["renamed", "updated"]:
        final_changes.append(c)
        continue

    key = (c["name"], c["commit_day"])
    if key not in updates:
        updates[key] = {"added": [], "removed": []}

    if c["status"] == "added":
        updates[key]["added"].append(c)
    elif c["status"] == "removed":
        updates[key]["removed"].append(c)

for (name, day), entry in updates.items():
    if entry["added"] and entry["removed"]:
        removed = entry["removed"][0]
        added = entry["added"][0]
        merged = {
            "status": "updated",
            "commit_day": day,
            "name": name,
            "lang": removed["lang"],
            "version": removed.get("version"),
        }
        if added.get("version") != removed.get("version"):
            merged["new_version"] = added.get("version")
        final_changes.append(merged)
    else:
        for c in entry["added"]:
            final_changes.append(c)
        for c in entry["removed"]:
            final_changes.append(c)


# --------------------------
# Step 7: Output JSON
# --------------------------
output = {"since": since, "changes": final_changes}
print(f"\nTotal changes collected: {len(final_changes)}")
status_count = {}
for c in final_changes:
    status_count[c["status"]] = status_count.get(c["status"], 0) + 1
print("Change counts by status:", status_count)

print("\nFinal JSON output:")
print(json.dumps(output, indent=2))
