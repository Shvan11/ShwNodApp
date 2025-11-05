#!/usr/bin/env python3
import re

# Read the file
with open('services/database/queries/template-queries.js', 'r') as f:
    content = f.read()

# Pattern for multi-line executeQuery with parameters
# Matches: executeQuery(query, [\n    ...\n    ]);
pattern = r'executeQuery\((query|.*?),\s*(\[[\s\S]*?\])\s*\)'

def replacer(match):
    first_arg = match.group(1)
    second_arg = match.group(2)

    # Check if it already has mapRowToObject
    if 'mapRowToObject' in match.group(0):
        return match.group(0)

    # Add mapRowToObject as third parameter
    return f'executeQuery({first_arg}, {second_arg}, mapRowToObject)'

content = re.sub(pattern, replacer, content)

# Write back
with open('services/database/queries/template-queries.js', 'w') as f:
    f.write(content)

print("Fixed all executeQuery calls (v2)!")
