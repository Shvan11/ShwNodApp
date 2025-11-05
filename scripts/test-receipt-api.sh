#!/bin/bash

# Test Receipt API Endpoints
# This script tests the new receipt generation endpoints

BASE_URL="http://localhost:3000/api/templates"

echo "=================================="
echo "Receipt Template API Tests"
echo "=================================="
echo ""

# Test 1: Get receipt data for a work
echo "Test 1: Get receipt data"
echo "GET $BASE_URL/receipt/data/1"
curl -s "$BASE_URL/receipt/data/1" | jq '.'
echo ""
echo ""

# Test 2: Generate receipt HTML for a work
echo "Test 2: Generate receipt HTML (work)"
echo "GET $BASE_URL/receipt/work/1"
curl -s "$BASE_URL/receipt/work/1" | head -50
echo ""
echo "... (truncated)"
echo ""

echo "=================================="
echo "Tests Complete"
echo "=================================="
