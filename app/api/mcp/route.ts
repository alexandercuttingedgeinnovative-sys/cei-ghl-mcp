import { createMcpHandler } from "mcp-handler";

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "ping",
      "Harmless connectivity test for the CEI MCP bridge.",
      {},
      async () => ({
        content: [{ type: "text" as const, text: "CEI MCP bridge is online." }],
      }),
    );
  },
  {},
  { basePath: "/api" },
);

export { handler as GET, handler as POST, handler as DELETE };
