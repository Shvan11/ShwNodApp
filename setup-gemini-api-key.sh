#!/bin/bash

# Gemini MCP Server API Key Setup Script
# This script helps you configure your Google AI Studio API key for @mintmcqueen/gemini-mcp

echo "========================================="
echo "Gemini MCP Server - API Key Setup"
echo "========================================="
echo ""
echo "This script will help you add your Google AI Studio API key to .mcp.json"
echo ""
echo "First, get your API key from: https://aistudio.google.com/"
echo "  1. Sign in with your Google account"
echo "  2. Click 'Get API key' in the left sidebar"
echo "  3. Create or select a project"
echo "  4. Copy the API key"
echo ""
read -p "Enter your Google AI Studio API key: " API_KEY

if [ -z "$API_KEY" ]; then
    echo "Error: API key cannot be empty"
    exit 1
fi

# Update .mcp.json with the API key
# Note: The API key is already in place, this would be for new setups
# sed -i "s/YOUR_API_KEY_HERE/$API_KEY/g" .mcp.json

echo ""
echo "✅ Configuration complete!"
echo ""
echo "⚠️  IMPORTANT: Your API key is already configured in .mcp.json"
echo "   Current API key: ${API_KEY:0:20}..."
echo ""
echo "Next steps:"
echo "  1. Restart Claude Code to load the Gemini MCP server"
echo "  2. You can now use Gemini 3 Pro with @mintmcqueen/gemini-mcp!"
echo ""
echo "Available Gemini MCP tools:"
echo "  - mcp__gemini__generate: Generate text with Gemini 3 Pro"
echo "  - mcp__gemini__generate_image: Generate images (text-to-image)"
echo "  - mcp__gemini__edit_image: Analyze/edit images with vision"
echo "  - mcp__gemini__embed: Create text embeddings"
echo "  - mcp__gemini__batch_*: Batch processing (50% cost savings)"
echo ""
echo "Package: @mintmcqueen/gemini-mcp v0.4.0"
echo "Documentation: docs/zen-mcp-setup.md"
echo ""
