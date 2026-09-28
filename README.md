# CEI HighLevel MCP Bridge

Private MCP bridge for Cutting Edge Innovative's HighLevel sub-account.

## MCP endpoint

After deploying to Vercel:

`https://YOUR-PROJECT.vercel.app/api/mcp`

## Required environment variables

- `GHL_PRIVATE_INTEGRATION_TOKEN` — HighLevel Private Integration Token
- `GHL_LOCATION_ID` — HighLevel sub-account/location ID
- `MCP_ACCESS_TOKEN` — a separate random secret used by ChatGPT to authenticate to this MCP server

Do not commit secrets to this repository.

## Exposed tools

- list_pipelines
- get_pipeline
- create_pipeline
- create_opportunity
- update_opportunity

There are intentionally no delete tools.
