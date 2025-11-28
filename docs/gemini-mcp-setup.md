# Gemini MCP Server Setup Guide

## Overview
Gemini MCP Server (`@mintmcqueen/gemini-mcp`) allows you to use Google's Gemini AI models (including Gemini 3 Pro) directly within Claude Code for various AI tasks like text generation, chat, image analysis, image generation, and embeddings.

## Installation Status
✅ **COMPLETED**: Gemini MCP Server has been added to `.mcp.json`

## Quick Setup (3 Steps)

### Step 1: Get Your Google AI Studio API Key

1. Visit **Google AI Studio**: https://aistudio.google.com/
2. Sign in with your Google account (the one with Gemini subscription)
3. In the left sidebar, click **"Get API key"**
4. Click **"Create API key"**
5. Select an existing Google Cloud project or create a new one
6. **Copy the API key** that's generated (starts with `AIza...`)

### Step 2: Add Your API Key

Run the setup script I created for you:

```bash
cd /home/administrator/projects/ShwNodApp
./setup-gemini-api-key.sh
```

Or manually edit `.mcp.json` and replace the value in `GEMINI_API_KEY` with your actual API key.

### Step 3: Restart Claude Code

After adding your API key, restart Claude Code to load the Gemini MCP server.

## Available Tools

Once configured, you'll have access to these Gemini MCP Server tools:

### 1. **Generate Text** (`mcp__gemini__generate`)
Generate text using Gemini 3 Pro models.

**Parameters:**
- `prompt` (required): The text prompt
- `model` (optional): Model to use (default: `gemini-3-pro-latest`)
  - Options: `gemini-3-pro-latest`, `gemini-3-flash-latest`, `gemini-2.0-flash-exp`
- `temperature` (optional): Creativity level (0.0 - 2.0)
- `maxTokens` (optional): Maximum tokens to generate

**Example:**
```
Generate a patient care summary for orthodontic treatment
```

### 2. **Generate Image** (`mcp__gemini__generate_image`)
Generate images using Gemini 3 Pro Image model (text-to-image).

**Parameters:**
- `prompt` (required): Description of image to generate
- `numberOfImages` (optional): Number of images (1-4, default: 1)
- `aspectRatio` (optional): Image aspect ratio (default: `1:1`)
  - Options: `1:1`, `3:4`, `4:3`, `9:16`, `16:9`

**Example:**
```
Generate a diagram showing orthodontic treatment stages
```

### 3. **Analyze/Edit Image** (`mcp__gemini__edit_image`)
Analyze or edit images with Gemini's vision capabilities.

**Parameters:**
- `imageData` (required): Base64 image data or URL
- `prompt` (required): What to analyze or how to edit
- `mode` (optional): `analyze` or `edit` (default: `analyze`)

**Example:**
```
Analyze patient x-ray images for dental assessment
```

### 4. **Generate Embeddings** (`mcp__gemini__embed`)
Create vector embeddings for text (useful for semantic search).

**Parameters:**
- `text` (required): Text to embed
- `model` (optional): Embedding model (default: `text-embedding-004`)

**Example:**
```
Create embeddings for patient treatment notes for similarity search
```

### 5. **Batch Processing** (`mcp__gemini__batch_*`)
Process multiple requests with 50% cost savings using Batch API.

**Tools:**
- `mcp__gemini__batch_upload` - Upload batch requests
- `mcp__gemini__batch_status` - Check batch status
- `mcp__gemini__batch_retrieve` - Get batch results

**Example:**
```
Process 100 patient appointment reminders in batch
```

## Model Options

### Recommended Models:

**For your Gemini 3 Pro subscription:**
- `gemini-3-pro-latest` - Best quality, latest Gemini 3 features (default)
- `gemini-3-flash-latest` - Fast, good quality, lower cost
- `gemini-3-pro-image` - Image generation and editing
- `gemini-2.0-flash-exp` - Experimental Gemini 2 features

### Usage Tips:

1. **General tasks**: Use `gemini-3-pro-latest` (default)
2. **Complex analysis**: Use `gemini-3-pro-latest`
3. **Bulk operations**: Use `gemini-3-flash-latest` or Batch API
4. **Vision tasks**: Use `gemini-3-pro-latest`
5. **Image generation**: Use `gemini-3-pro-image`

## Configuration

The Gemini MCP Server is configured in `.mcp.json`:

```json
{
  "gemini": {
    "command": "npx",
    "args": ["-y", "@mintmcqueen/gemini-mcp"],
    "env": {
      "GEMINI_API_KEY": "YOUR_API_KEY_HERE"
    }
  }
}
```

## Use Cases for Your Orthodontic System

1. **Patient Communication**:
   - Generate personalized appointment reminders
   - Create treatment explanation letters
   - Draft follow-up messages
   - Batch process 100s of reminder messages at 50% cost

2. **Treatment Analysis**:
   - Analyze x-ray images for dental assessment
   - Generate treatment plan summaries
   - Create progress reports
   - Compare before/after treatment photos

3. **Visual Content Creation**:
   - Generate diagrams for treatment explanations
   - Create educational illustrations
   - Design patient education graphics
   - Visualize treatment stages

4. **Data Processing**:
   - Generate embeddings for patient notes (semantic search)
   - Classify patient feedback
   - Extract information from treatment notes
   - Batch process large datasets

5. **Documentation**:
   - Generate template content
   - Create patient education materials
   - Draft reports and summaries

## Troubleshooting

### API Key Issues
- Ensure your API key starts with `AIza...`
- Check that you have billing enabled in Google Cloud
- Verify your Gemini subscription is active

### MCP Server Not Loading
- Restart Claude Code after configuration changes
- Check `.mcp.json` syntax (must be valid JSON)
- Verify `npx` is available: `which npx`

### Model Access Issues
- Some models require specific API access
- Check Google AI Studio for model availability
- Try using `gemini-1.5-flash` if other models fail

## API Rate Limits

Google AI Studio has rate limits based on your subscription:
- **Free tier**: 15 requests per minute
- **Paid tier**: Higher limits (check your plan)

If you hit rate limits, the server will return an error. Consider:
- Using `gemini-1.5-flash` for faster, cheaper requests
- Implementing delays between bulk operations
- Upgrading your Google Cloud billing tier

## Security Notes

⚠️ **IMPORTANT**:
- Never commit `.mcp.json` with your API key to version control
- Add `.mcp.json` to `.gitignore` if it contains secrets
- Keep your API key secure and rotate it periodically
- Monitor your Google Cloud billing for unexpected usage

## Resources

- **Gemini MCP Server**: https://github.com/mintmcqueen/gemini-mcp
- **NPM Package**: https://www.npmjs.com/package/@mintmcqueen/gemini-mcp
- **Google AI Studio**: https://aistudio.google.com/
- **Gemini API Docs**: https://ai.google.dev/docs
- **MCP Protocol**: https://modelcontextprotocol.io/

## Next Steps

1. ✅ Run `./setup-gemini-api-key.sh` to add your API key (optional - already configured)
2. ✅ Restart Claude Code
3. ✅ Test the integration by asking Claude to use Gemini MCP tools
4. ✅ Explore use cases for your orthodontic system

---

**Setup completed**: 2025-11-28
**Last updated**: 2025-11-28
**Package**: `@mintmcqueen/gemini-mcp` v0.4.0
**Configuration file**: `.mcp.json`
**Status**: ✅ Ready - Restart Claude Code to activate
