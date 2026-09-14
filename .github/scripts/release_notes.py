"""Cut the CHANGELOG section of the version being released into the release text.

Without it the release page stays empty, and so does the notes address that the
Foundry package listing shows for this version. Whoever is offered the update and
wants to know what changed would find nothing.

Usage: VERSION=14.2609.4 python .github/scripts/release_notes.py
Reads CHANGELOG.md, writes release-notes.md, both in the working directory.
Headings look like "## [14.2609.4] - 2026-09-14".
"""
import os
import re
import sys

version = os.environ["VERSION"]
text = open("CHANGELOG.md", encoding="utf-8").read()

# The section of this version, up to the next version heading or the end of the file.
pattern = r"^## \[%s\][^\n]*\n(.*?)(?=^## \[|\Z)" % re.escape(version)
match = re.search(pattern, text, re.S | re.M)
notes = match.group(1).strip() if match else ""

if not notes:
    # Fail instead of publishing a release whose text is a warning.
    print("ERROR: CHANGELOG.md has no section for %s." % version, file=sys.stderr)
    sys.exit(1)

open("release-notes.md", "w", encoding="utf-8").write(notes + "\n")
print("Release text: %d characters" % len(notes))
