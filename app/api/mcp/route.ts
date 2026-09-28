import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

const GHL_BASE = "https://services.leadconnectorhq.com";

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

function result(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "list_pipelines",
      "List all HighLevel opportunity pipelines and stages for the configured Cutting Edge Innovative sub-account.",
      {},
      async () => {
        const locationId = requireEnv("GHL_LOCATION_ID");
        return result(await ghl(`/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`));
      },
    );

    server.tool(
      "get_pipeline",
      "Get one HighLevel opportunity pipeline including its stages.",
      { pipelineId: z.string().min(1) },
      async ({ pipelineId }) =>
        result(await ghl(`/opportunities/pipelines/${encodeURIComponent(pipelineId)}`)),
    );

    server.tool(
      "create_pipeline",
      "Create a new HighLevel opportunity pipeline with ordered stages. Does not modify existing pipelines.",
      {
        name: z.string().min(1),
        stages: z.array(z.string().min(1)).min(1),
        showInFunnel: z.boolean().optional().default(false),
        showInPieChart: z.boolean().optional().default(true),
      },
      async ({ name, stages, showInFunnel, showInPieChart }) => {
        const locationId = requireEnv("GHL_LOCATION_ID");
        const body = {
          name,
          stages: stages.map((stageName, index) => ({
            name: stageName,
            position: index + 1,
            showInFunnel: true,
          })),
          showInFunnel,
          showInPieChart,
          useOpportunityProbability: false,
          locationId,
          colorRenderMode: "dot",
        };
        return result(await ghl("/opportunities/pipelines", {
          method: "POST",
          body: JSON.stringify(body),
        }));
      },
    );

    server.tool(
      "create_opportunity",
      "Create a new opportunity for an existing HighLevel contact in a specified pipeline and stage.",
      {
        contactId: z.string().min(1),
        pipelineId: z.string().min(1),
        pipelineStageId: z.string().min(1),
        name: z.string().min(1),
        status: z.enum(["open", "won", "lost", "abandoned"]).default("open"),
        monetaryValue: z.number().nonnegative().optional(),
        assignedTo: z.string().optional(),
      },
      async (input) => {
        const locationId = requireEnv("GHL_LOCATION_ID");
        return result(await ghl("/opportunities/", {
          method: "POST",
          body: JSON.stringify({ ...input, locationId }),
        }));
      },
    );

    server.tool(
      "update_opportunity",
      "Update an existing HighLevel opportunity, including moving it to another pipeline stage.",
      {
        opportunityId: z.string().min(1),
        pipelineId: z.string().optional(),
        pipelineStageId: z.string().optional(),
        name: z.string().optional(),
        status: z.enum(["open", "won", "lost", "abandoned"]).optional(),
        monetaryValue: z.number().nonnegative().optional(),
        assignedTo: z.string().optional(),
      },
      async ({ opportunityId, ...updates }) =>
        result(await ghl(`/opportunities/${encodeURIComponent(opportunityId)}`, {
          method: "PUT",
          body: JSON.stringify(updates),
        })),
    );
  },
  {},
  { basePath: "/api" },
);

function authorized(req: Request) {
  const expected = process.env.MCP_ACCESS_TOKEN;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

function unauthorized() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(req: Request) {
  if (!authorized(req)) return unauthorized();
  return handler(req);
}

export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  return handler(req);
}

export async function DELETE(req: Request) {
  if (!authorized(req)) return unauthorized();
  return handler(req);
}
