#!/bin/bash
echo "=== Checking CSS Button Styles ==="
echo ""
echo "Searching for button background colors in work-card.css:"
echo ""
grep -n "background-color:" /home/administrator/projects/ShwNodApp/public/css/components/work-card.css | grep -E "(btn-checkin|btn-primary|btn-secondary)" -A 1 | head -20
echo ""
echo "=== All three buttons should show: background-color: var(--indigo-600); ==="
