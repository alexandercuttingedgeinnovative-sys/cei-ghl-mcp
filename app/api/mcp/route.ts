import { createMcpHandler } from "mcp-handler";

const GHL_BASE = "https://services.leadconnectorhq.com";
const PIPELINE_NAME = "Fast Track | Reactivation";
const STAGES = [
  "Queued for Reactivation",
  "Outreach Active",
  "Responded - Needs Qualification",
  "Fast Track Qualified",
  "Core Project Qualified",
  "Future Opportunity",
  "Project Already Completed",
  "Not Interested / Do Not Pursue",
  "No Response",
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function ghl(path: string, init: RequestInit = {}) {
  const token = requireEnv("GHL_PRIVATE_INTEGRATION_TOKEN");
  const response = await fetch(`${GHL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Version: "v3",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {}

  if (!response.ok) {
    throw new Error(`HighLevel API ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }

  return body;
}

function asText(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

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

    server.tool(
      "ensure_fast_track_reactivation_pipeline",
      "Ensure the exact Fast Track | Reactivation pipeline exists in Cutting Edge Innovative. If it already exists, no duplicate is created. This tool cannot create any other pipeline.",
      {},
      async () => {
        const locationId = requireEnv("GHL_LOCATION_ID");
        const current: any = await ghl(
          `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
        );
        const pipelines = Array.isArray(current?.pipelines) ? current.pipelines : [];
        const existing = pipelines.find((p: any) =>
          String(p?.name || "").toLowerCase() === PIPELINE_NAME.toLowerCase()
        );

        if (existing) {
          return asText({
            created: false,
            message: "Pipeline already exists; no changes made.",
            pipeline: existing,
          });
        }

        const created = await ghl("/opportunities/pipelines", {
          method: "POST",
          body: JSON.stringify({
            name: PIPELINE_NAME,
            stages: STAGES.map((name, index) => ({
              name,
              position: index + 1,
              showInFunnel: true,
            })),
            showInFunnel: false,
            showInPieChart: true,
            useOpportunityProbability: false,
            locationId,
            colorRenderMode: "dot",
          }),
        });

        return asText({
          created: true,
          message: "Fast Track | Reactivation pipeline created.",
          pipeline: created,
        });
      },
    );
  },
  {},
  { basePath: "/api" },
);

export { handler as GET, handler as POST, handler as DELETE };
