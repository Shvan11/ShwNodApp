# MSSQL MCP Server Setup

This project is configured with the Microsoft SQL Server Model Context Protocol (MCP) server, which allows AI assistants like Claude Code to interact directly with your SQL Server database.

## What is MCP?

The Model Context Protocol (MCP) is an open standard that enables seamless interaction between AI agents and external resources. The MSSQL MCP Server provides a secure, controlled gateway for AI assistants to:

- List database tables and schemas
- Read table contents
- Execute SQL queries with controlled access
- Explore database structure naturally

## Configuration

The MSSQL MCP server is configured in `.mcp.json` and uses your existing database environment variables from `.env`.

### Environment Variables Used

The MCP server automatically uses these variables from your `.env` file:

- `DB_SERVER` - SQL Server hostname/address
- `DB_INSTANCE` - SQL Server instance name (if using named instances)
- `DB_USER` - Database username
- `DB_PASSWORD` - Database password
- `DB_DATABASE` - Database name (defaults to "ShwanNew" if not set)

### MCP Configuration

The `.mcp.json` file contains:

```json
{
  "mcpServers": {
    "mssql": {
      "command": "npx",
      "args": ["-y", "@wener/mssql-mcp", "--stdio"],
      "env": {
        "MSSQL_SERVER": "${DB_SERVER}",
        "MSSQL_PORT": "1433",
        "MSSQL_USER": "${DB_USER}",
        "MSSQL_PASSWORD": "${DB_PASSWORD}",
        "MSSQL_DATABASE": "${DB_DATABASE}",
        "MSSQL_ENCRYPT": "false",
        "MSSQL_TRUST_SERVER_CERTIFICATE": "true",
        "MSSQL_INSTANCE": "${DB_INSTANCE}"
      }
    }
  }
}
```

## Usage with Claude Code

Once configured, you can ask Claude Code to:

### Explore Database Schema
```
"Show me all tables in the database"
"What columns does the Patients table have?"
"Describe the schema for the Appointments table"
```

### Query Data
```
"Show me the first 10 patients"
"How many appointments are scheduled for today?"
"List all patients with unpaid invoices"
```

### Analyze Data
```
"What is the average payment amount?"
"Show me patient visit trends over the last month"
"Which patients have the most appointments?"
```

### Generate SQL
```
"Write a query to find patients who haven't visited in 6 months"
"Create a query to calculate total revenue by month"
"Help me write a stored procedure to update appointment statuses"
```

## Security Features

The MCP server includes several security features:

1. **Read-only mode** - Can be configured to prevent data modification
2. **Query validation** - Validates SQL queries before execution
3. **Permission enforcement** - Respects database user permissions
4. **Logging** - All database interactions are logged
5. **Controlled access** - Only accessible through authenticated Claude Code sessions

## Package Information

- **Package**: `@wener/mssql-mcp`
- **Version**: 1.0.1
- **License**: MIT
- **Installation**: Automatic via npx (no manual installation needed)
- **Transport**: STDIO (standard input/output)

## Troubleshooting

### Connection Issues

If the MCP server can't connect:

1. Verify your `.env` file has correct database credentials
2. Check that SQL Server is accessible from your machine
3. Ensure the SQL Server instance is running
4. Verify firewall rules allow port 1433 (default SQL Server port)

### Query Failures

If queries fail:

1. Check database user permissions
2. Verify the database name is correct
3. Ensure tables/views exist
4. Check SQL syntax

### Restart Claude Code

After making changes to `.mcp.json`, restart Claude Code to pick up the new configuration.

## Advanced Configuration

### Using Multiple Databases

You can configure multiple MSSQL MCP servers for different databases:

```json
{
  "mcpServers": {
    "mssql-production": {
      "command": "npx",
      "args": ["-y", "@wener/mssql-mcp", "--stdio"],
      "env": {
        "MSSQL_SERVER": "prod-server",
        "MSSQL_DATABASE": "ProductionDB"
      }
    },
    "mssql-reporting": {
      "command": "npx",
      "args": ["-y", "@wener/mssql-mcp", "--stdio"],
      "env": {
        "MSSQL_SERVER": "report-server",
        "MSSQL_DATABASE": "ReportingDB"
      }
    }
  }
}
```

### Enable Encryption

For production environments, enable SQL Server encryption:

```json
"env": {
  "MSSQL_ENCRYPT": "true",
  "MSSQL_TRUST_SERVER_CERTIFICATE": "false"
}
```

## Resources

- [Model Context Protocol Documentation](https://modelcontextprotocol.io)
- [@wener/mssql-mcp on npm](https://www.npmjs.com/package/@wener/mssql-mcp)
- [Microsoft SQL Server Documentation](https://learn.microsoft.com/en-us/sql/)

## Notes

- The MCP server uses the same credentials as your application
- All queries are executed with the permissions of the configured database user
- The server is only active when Claude Code is running and needs database access
- No data is sent to external servers - all processing happens locally
