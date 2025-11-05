#!/bin/bash

# Template API Test Script
# Run this after restarting the server to test all endpoints

BASE_URL="http://localhost:3000/api/templates"

echo "======================================"
echo "Testing Document Template API"
echo "======================================"
echo ""

# Test 1: Get all document types
echo "1. Testing GET /api/templates/document-types"
curl -s "$BASE_URL/document-types" | jq '.'
echo ""
echo "--------------------------------------"
echo ""

# Test 2: Get data fields for receipts (document_type_id = 1)
echo "2. Testing GET /api/templates/data-fields/1 (Receipt fields)"
curl -s "$BASE_URL/data-fields/1" | jq '.data | length'
echo " data fields found"
echo "--------------------------------------"
echo ""

# Test 3: Get all templates
echo "3. Testing GET /api/templates"
curl -s "$BASE_URL" | jq '.'
echo "--------------------------------------"
echo ""

# Test 4: Create a simple test template
echo "4. Testing POST /api/templates (Create template)"
curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "template_name": "Test Receipt Template",
    "description": "Simple test template",
    "document_type_id": 1,
    "paper_width": 80,
    "paper_height": 297,
    "created_by": "test-script"
  }' | jq '.'
echo "--------------------------------------"
echo ""

echo "======================================"
echo "✅ API tests complete!"
echo "======================================"
echo ""
echo "If all tests passed, the backend is working correctly."
echo "Next steps:"
echo "  1. Migrate your current receipt to a template"
echo "  2. Build the UI components"
echo ""
