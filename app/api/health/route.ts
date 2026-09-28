export async function GET() {
  return Response.json({
    ok: true,
    service: "cei-ghl-mcp",
    ghlTokenConfigured: Boolean(process.env.GHL_PRIVATE_INTEGRATION_TOKEN),
    ghlLocationConfigured: Boolean(process.env.GHL_LOCATION_ID),
    mcpAccessTokenConfigured: Boolean(process.env.MCP_ACCESS_TOKEN),
  });
}
