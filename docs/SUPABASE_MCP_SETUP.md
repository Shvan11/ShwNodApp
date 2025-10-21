# Supabase MCP Server Configuration - CRITICAL DISCOVERY

## Problem Discovered
The Supabase MCP server configuration in `.mcp.json` was INCORRECTLY configured as a local npm package command, which does NOT work with Claude Code.

## The Wrong Configuration (OLD - DO NOT USE)
```json
"supabase": {
  "command": "npx",
  "args": [
    "-y",
    "@supabase/mcp-server-supabase",
    "--supabase-url",
    "https://zrrifrxmqjboyxyylmwa.supabase.co",
    "--supabase-key",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  ]
}
```

**Why this is wrong:**
- This is an outdated approach from older MCP implementations
- The `@supabase/mcp-server-supabase` npm package approach doesn't work with Claude Code
- Credentials should NOT be hardcoded in the configuration file
- This configuration will NOT expose MCP tools to Claude

## The Correct Configuration (NEW - CURRENTLY ACTIVE)
```json
"supabase": {
  "type": "http",
  "url": "https://mcp.supabase.com/mcp?project_ref=zrrifrxmqjboyxyylmwa"
}
```

**Why this is correct:**
- Uses the official Supabase MCP HTTP endpoint at `https://mcp.supabase.com/mcp`
- Specifies `type: "http"` to indicate HTTP-based MCP server
- Uses `project_ref` query parameter to scope to specific project
- Authentication happens via OAuth browser flow (NO hardcoded credentials)
- This is the modern, official approach as of 2025

## Configuration Options

### Project Scoping (Recommended)
```
https://mcp.supabase.com/mcp?project_ref=zrrifrxmqjboyxyylmwa
```
Limits the MCP server to only this specific Supabase project.

### Read-Only Mode (For Production Safety)
```
https://mcp.supabase.com/mcp?project_ref=zrrifrxmqjboyxyylmwa&read_only=true
```
Prevents all write operations - useful if connecting to production data.

### Feature Groups (Selective Tool Access)
```
https://mcp.supabase.com/mcp?project_ref=zrrifrxmqjboyxyylmwa&features=database,docs
```
Available feature groups:
- `account` - Organization and project management
- `docs` - Documentation search
- `database` - Database queries and management
- `debugging` - Logs and monitoring
- `development` - Migrations and schema changes
- `functions` - Edge Functions management
- `storage` - Storage bucket operations
- `branching` - Branch operations

## Authentication Process

After restart, Claude Code will:
1. Detect the new HTTP MCP server configuration
2. Automatically prompt you to authenticate via browser
3. Open Supabase OAuth login page
4. You log in and grant access to your organization
5. MCP tools become available to Claude

**IMPORTANT:** You MUST restart Claude Code for the configuration to take effect!

## Available MCP Tools (After Authentication)

Once configured, Claude will have access to tools like:
- Query Supabase tables directly
- Execute SQL queries
- Manage database schema
- Create/update/delete records
- Access Edge Functions
- Manage storage buckets
- And more...

## Project Details

- **Supabase URL:** `https://zrrifrxmqjboyxyylmwa.supabase.co`
- **Project Ref:** `zrrifrxmqjboyxyylmwa`
- **Database Tables:**
  - `aligner_doctors` - Doctor authentication and info
  - `aligner_sets` - Aligner treatment sets
  - `aligner_batches` - Batches within sets
  - `aligner_notes` - Communication between doctors and lab
  - `aligner_set_payments` - Payment tracking

## Security Notes

1. **Never commit service_role keys to git** - The old configuration had this issue
2. **Use project scoping** - Limits blast radius if something goes wrong
3. **Consider read_only mode** - If you need to query production data
4. **Use feature groups** - Disable tools you don't need (principle of least privilege)

## Troubleshooting

### MCP Tools Not Showing Up
1. Verify `.mcp.json` has the correct HTTP configuration
2. Restart Claude Code completely
3. Check that authentication completed successfully
4. Look for green indicator next to "supabase" in MCP servers list

### "Tenant or user not found" Error
- Your project might be in a different region
- Add `region` parameter if needed (though not required for most cases)

### Authentication Failed
- Clear browser cookies for supabase.com
- Try authentication flow again
- Ensure you're selecting the correct organization

## Migration Script Reference

The PostgreSQL schema for this Supabase instance is defined in:
`/migrations/postgresql/01_create_aligner_tables.sql`

This includes:
- All table definitions
- Indexes for performance
- Row Level Security (RLS) policies
- Triggers for auto-updating timestamps
- Comments for documentation

## Related Documentation

- Official Supabase MCP Docs: https://supabase.com/docs/guides/getting-started/mcp
- GitHub Repository: https://github.com/supabase-community/supabase-mcp
- Blog Post: https://supabase.com/blog/mcp-server

## Date of Discovery
2025-10-21

## Fixed By
Claude Code session - Fixed incorrect npx-based configuration to proper HTTP endpoint configuration.
