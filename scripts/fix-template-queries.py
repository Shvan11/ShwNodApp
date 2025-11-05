#!/usr/bin/env python3
import re

# Read the file
with open('services/database/queries/template-queries.js', 'r') as f:
    content = f.read()

# Pattern 1: executeQuery(query, [params...]);
# Replace with: executeQuery(query, [params...], mapRowToObject);
pattern1 = r'executeQuery\(([^,]+),\s*(\[[^\]]*\])\s*\);'
content = re.sub(pattern1, r'executeQuery(\1, \2, mapRowToObject);', content)

# Pattern 2: executeQuery(query, [params...])
# (without semicolon, usually in return statements)
pattern2 = r'executeQuery\(([^,]+),\s*(\[[^\]]*\])\s*\)([^;])'
content = re.sub(pattern2, r'executeQuery(\1, \2, mapRowToObject)\3', content)

# Write back
with open('services/database/queries/template-queries.js', 'w') as f:
    f.write(content)

print("Fixed all executeQuery calls!")
