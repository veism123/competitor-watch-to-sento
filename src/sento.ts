import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// The courier authenticates with a single machine-writer key (no token
// exchange). Every write goes through the gate: it must cite an entity id
// taken from a prior read, so each cycle is read-then-write by construction.
// write_list_entry arguments verified against the live tool schema
// 2026-09-01: entity_id (uuid), body, name (<=120 chars, no control chars),
// occurred_at (ISO-8601 with timezone), structured (JSON).
export class SentoClient {
  private client: Client | null = null;

  constructor(private url: string, private key: string) {}

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    const transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: { headers: { Authorization: `Bearer ${this.key}` } },
    });
    const client = new Client({ name: "sento-courier", version: "0.1.0" });
    await client.connect(transport);
    this.client = client;
    return client;
  }

  private async call(name: string, args: Record<string, unknown>): Promise<string> {
    const client = await this.connect();
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ type: string; text?: string }> | undefined)
      ?.filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n") ?? "";
    if (result.isError) throw new Error(`Sento ${name} rejected: ${text}`);
    return text;
  }

  // Resolve the entity id fresh every cycle by name; never hardcode ids.
  async findEntityIdByName(name: string): Promise<string> {
    const listing = await this.call("list_entities", { seeking: [name] });
    const pattern = new RegExp(
      `"${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[\\s\\S]*?id: ([0-9a-f-]{36})`
    );
    const match = listing.match(pattern);
    if (!match) throw new Error(`Entity "${name}" not found in list_entities output`);
    return match[1];
  }

  // Returns the raw get_entity text; callers scan it for source ids already
  // written (the granola_note_id recorded per entry), which is the dedupe check.
  async readEntity(id: string): Promise<string> {
    return this.call("get_entity", { id });
  }

  // Two-level list read: one entry's full body (raw response text; callers
  // strip the fence markers).
  async readListEntry(id: string, entryId: string): Promise<string> {
    return this.call("get_entity", { id, entry_id: entryId });
  }

  // Rewrite one list entry in place (living-document lists only). Sends the
  // full new content; name null keeps no name, structured null clears it.
  async updateListEntry(args: {
    entityId: string;
    entryId: string;
    name: string | null;
    body: string;
    structured: Record<string, unknown> | null;
  }): Promise<string> {
    return this.call("update_list_entry", {
      entity_id: args.entityId,
      entry_id: args.entryId,
      name: args.name,
      body: args.body,
      structured: args.structured,
    });
  }

  // The workspace's own composing conventions for the entity. Readable by any
  // caller permitted to write it, so the courier key can fetch it; a person
  // reviews it once and encodes its rules in this courier's config.
  async readAuthoringGuide(entityId: string): Promise<string> {
    return this.call("get_authoring_guide", { entity_id: entityId });
  }

  // Verbatim observation append. Argument names verified against the live
  // write_metric schema 2026-09-01: entity_id, value, observed_at.
  async writeMetric(args: {
    entityId: string;
    value: number | string;
    observedAt: string;
  }): Promise<string> {
    return this.call("write_metric", {
      entity_id: args.entityId,
      value: args.value,
      observed_at: args.observedAt,
    });
  }

  async writeListEntry(args: {
    entityId: string;
    name: string;
    body: string;
    occurredAt?: string;
    structured?: Record<string, unknown>;
  }): Promise<string> {
    return this.call("write_list_entry", {
      entity_id: args.entityId,
      body: args.body,
      name: args.name,
      ...(args.occurredAt ? { occurred_at: args.occurredAt } : {}),
      ...(args.structured ? { structured: args.structured } : {}),
    });
  }
}
