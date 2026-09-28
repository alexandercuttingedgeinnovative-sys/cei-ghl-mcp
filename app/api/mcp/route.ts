import { createMcpHandler } from "mcp-handler";
import { z } from "zod";

const GHL_BASE = "https://services.leadconnectorhq.com";
const LOCATION_ID_ENV = "GHL_LOCATION_ID";
const PIPELINE_NAME = "Fast Track | Reactivation";
const REACTIVATION_STAGES = [
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
    throw new Error(
      `HighLevel API ${response.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`,
    );
  }

  return body;
}

function asText(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

async function getPipelines() {
  const locationId = requireEnv(LOCATION_ID_ENV);
  return (await ghl(
    `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
  )) as any;
}

async function findReactivationPipeline() {
  const current = await getPipelines();
  const pipelines = Array.isArray(current?.pipelines) ? current.pipelines : [];
  return pipelines.find(
    (p: any) => String(p?.name || "").toLowerCase() === PIPELINE_NAME.toLowerCase(),
  );
}

async function requireReactivationPipeline() {
  const pipeline = await findReactivationPipeline();
  if (!pipeline) {
    throw new Error(
      `${PIPELINE_NAME} does not exist yet. Run ensure_fast_track_reactivation_pipeline first.`,
    );
  }
  return pipeline;
}

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "ping",
      "Harmless connectivity test for the CEI HighLevel MCP bridge.",
      {},
      async () => ({
        content: [{ type: "text" as const, text: "CEI MCP bridge is online." }],
      }),
    );

    server.tool(
      "list_pipelines",
      "List HighLevel opportunity pipelines and stages for the configured Cutting Edge Innovative sub-account.",
      {},
      async () => asText(await getPipelines()),
    );

    server.tool(
      "get_pipeline",
      "Get one HighLevel opportunity pipeline by pipeline ID.",
      { pipelineId: z.string().min(1) },
      async ({ pipelineId }) =>
        asText(await ghl(`/opportunities/pipelines/${encodeURIComponent(pipelineId)}`)),
    );

    server.tool(
      "ensure_fast_track_reactivation_pipeline",
      "Ensure the exact Fast Track | Reactivation pipeline exists with the approved nine stages. If it already exists, no duplicate is created. This tool cannot create any other pipeline.",
      {},
      async () => {
        const existing = await findReactivationPipeline();
        if (existing) {
          return asText({
            created: false,
            message: "Pipeline already exists; no changes made.",
            pipeline: existing,
          });
        }

        const locationId = requireEnv(LOCATION_ID_ENV);
        const created = await ghl("/opportunities/pipelines", {
          method: "POST",
          body: JSON.stringify({
            name: PIPELINE_NAME,
            stages: REACTIVATION_STAGES.map((name, index) => ({
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

    server.tool(
      "get_opportunity",
      "Get one HighLevel opportunity by opportunity ID. Read-only.",
      { opportunityId: z.string().min(1) },
      async ({ opportunityId }) =>
        asText(await ghl(`/opportunities/${encodeURIComponent(opportunityId)}`)),
    );

    server.tool(
      "create_reactivation_opportunity",
      "Create a NEW reactivation opportunity for an existing contact in Fast Track | Reactivation. The original historical opportunity is not moved or modified.",
      {
        contactId: z.string().min(1),
        opportunityName: z.string().min(1),
        stageName: z.enum([
          "Queued for Reactivation",
          "Outreach Active",
          "Responded - Needs Qualification",
          "Fast Track Qualified",
          "Core Project Qualified",
          "Future Opportunity",
          "Project Already Completed",
          "Not Interested / Do Not Pursue",
          "No Response",
        ]).default("Queued for Reactivation"),
        monetaryValue: z.number().nonnegative().optional(),
        assignedTo: z.string().optional(),
      },
      async ({ contactId, opportunityName, stageName, monetaryValue, assignedTo }) => {
        const pipeline = await requireReactivationPipeline();
        const stage = Array.isArray(pipeline?.stages)
          ? pipeline.stages.find((s: any) => s?.name === stageName)
          : undefined;
        if (!stage?.id) throw new Error(`Stage not found: ${stageName}`);

        const locationId = requireEnv(LOCATION_ID_ENV);
        const body: Record<string, unknown> = {
          pipelineId: pipeline.id,
          locationId,
          name: opportunityName,
          pipelineStageId: stage.id,
          status: "open",
          contactId,
        };
        if (monetaryValue !== undefined) body.monetaryValue = monetaryValue;
        if (assignedTo) body.assignedTo = assignedTo;

        return asText(await ghl("/opportunities/", {
          method: "POST",
          body: JSON.stringify(body),
        }));
      },
    );

    server.tool(
      "update_reactivation_opportunity",
      "Update or move an opportunity only if it already belongs to Fast Track | Reactivation. Historical opportunities in other pipelines cannot be modified by this tool.",
      {
        opportunityId: z.string().min(1),
        stageName: z.enum([
          "Queued for Reactivation",
          "Outreach Active",
          "Responded - Needs Qualification",
          "Fast Track Qualified",
          "Core Project Qualified",
          "Future Opportunity",
          "Project Already Completed",
          "Not Interested / Do Not Pursue",
          "No Response",
        ]).optional(),
        status: z.enum(["open", "won", "lost", "abandoned"]).optional(),
        monetaryValue: z.number().nonnegative().optional(),
        assignedTo: z.string().optional(),
        opportunityName: z.string().min(1).optional(),
      },
      async ({ opportunityId, stageName, status, monetaryValue, assignedTo, opportunityName }) => {
        const pipeline = await requireReactivationPipeline();
        const current: any = await ghl(`/opportunities/${encodeURIComponent(opportunityId)}`);
        const opp = current?.opportunity ?? current;

        if (opp?.pipelineId !== pipeline.id) {
          throw new Error("Refusing update: opportunity is not in Fast Track | Reactivation.");
        }

        const updates: Record<string, unknown> = {};
        if (stageName) {
          const stage = Array.isArray(pipeline?.stages)
            ? pipeline.stages.find((s: any) => s?.name === stageName)
            : undefined;
          if (!stage?.id) throw new Error(`Stage not found: ${stageName}`);
          updates.pipelineId = pipeline.id;
          updates.pipelineStageId = stage.id;
        }
        if (status) updates.status = status;
        if (monetaryValue !== undefined) updates.monetaryValue = monetaryValue;
        if (assignedTo) updates.assignedTo = assignedTo;
        if (opportunityName) updates.name = opportunityName;

        if (Object.keys(updates).length === 0) {
          throw new Error("No updates were provided.");
        }

        return asText(await ghl(`/opportunities/${encodeURIComponent(opportunityId)}`, {
          method: "PUT",
          body: JSON.stringify(updates),
        }));
      },
    );

    server.tool(
      "get_contact",
      "Get a HighLevel contact by contact ID. Read-only.",
      { contactId: z.string().min(1) },
      async ({ contactId }) =>
        asText(await ghl(`/contacts/${encodeURIComponent(contactId)}`)),
    );

    server.tool(
      "update_contact_reactivation_fields",
      "Update selected non-destructive contact fields used for reactivation, such as assignment or approved custom-field values. Does not replace tags, change DND, or modify attribution/source.",
      {
        contactId: z.string().min(1),
        assignedTo: z.string().optional(),
        customFields: z.array(z.object({
          id: z.string().optional(),
          key: z.string().optional(),
          fieldValue: z.any(),
        })).optional(),
      },
      async ({ contactId, assignedTo, customFields }) => {
        const body: Record<string, unknown> = {};
        if (assignedTo) body.assignedTo = assignedTo;
        if (customFields?.length) body.customFields = customFields;
        if (Object.keys(body).length === 0) throw new Error("No updates were provided.");

        return asText(await ghl(`/contacts/${encodeURIComponent(contactId)}`, {
          method: "PUT",
          body: JSON.stringify(body),
        }));
      },
    );

    server.tool(
      "add_contact_tags",
      "Add one or more tags to an existing contact without removing existing tags.",
      {
        contactId: z.string().min(1),
        tags: z.array(z.string().min(1)).min(1).max(20),
      },
      async ({ contactId, tags }) =>
        asText(await ghl(`/contacts/${encodeURIComponent(contactId)}/tags`, {
          method: "POST",
          body: JSON.stringify({ tags }),
        })),
    );

    server.tool(
      "remove_contact_tags",
      "Remove only the specified tags from an existing contact.",
      {
        contactId: z.string().min(1),
        tags: z.array(z.string().min(1)).min(1).max(20),
      },
      async ({ contactId, tags }) =>
        asText(await ghl(`/contacts/${encodeURIComponent(contactId)}/tags`, {
          method: "DELETE",
          body: JSON.stringify({ tags }),
        })),
    );

    server.tool(
      "list_workflows",
      "List HighLevel workflows in the configured Cutting Edge Innovative sub-account. Read-only.",
      {},
      async () => {
        const locationId = requireEnv(LOCATION_ID_ENV);
        return asText(await ghl(`/workflows/?locationId=${encodeURIComponent(locationId)}`));
      },
    );

    server.tool(
      "add_contact_to_workflow",
      "Enroll one existing contact into an existing HighLevel workflow. Does not create or edit the workflow itself.",
      {
        contactId: z.string().min(1),
        workflowId: z.string().min(1),
        eventStartTime: z.string().datetime().optional(),
      },
      async ({ contactId, workflowId, eventStartTime }) =>
        asText(await ghl(
          `/contacts/${encodeURIComponent(contactId)}/workflow/${encodeURIComponent(workflowId)}`,
          {
            method: "POST",
            body: JSON.stringify({
              eventStartTime: eventStartTime ?? new Date().toISOString(),
            }),
          },
        )),
    );

    server.tool(
      "remove_contact_from_workflow",
      "Remove one contact from an existing HighLevel workflow to stop that workflow for the contact.",
      {
        contactId: z.string().min(1),
        workflowId: z.string().min(1),
        eventStartTime: z.string().datetime().optional(),
      },
      async ({ contactId, workflowId, eventStartTime }) =>
        asText(await ghl(
          `/contacts/${encodeURIComponent(contactId)}/workflow/${encodeURIComponent(workflowId)}`,
          {
            method: "DELETE",
            body: JSON.stringify({
              eventStartTime: eventStartTime ?? new Date().toISOString(),
            }),
          },
        )),
    );
  },
  {},
  { basePath: "/api" },
);

export { handler as GET, handler as POST, handler as DELETE };
