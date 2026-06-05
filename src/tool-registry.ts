/**
 * Tool Registry — bridges existing tool classes to McpServer.registerTool()
 * 
 * Reads tool definitions from all existing tool classes, infers annotations
 * from tool names and metadata, and registers them with the McpServer API.
 * 
 * This avoids rewriting 38 tool files while getting all the benefits of
 * the new SDK: annotations, Zod validation, structured responses.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ToolAnnotations, Tool } from '@modelcontextprotocol/sdk/types.js';

import { GHLApiClient } from './clients/ghl-api-client.js';
import { ContactTools } from './tools/contact-tools.js';
import { ConversationTools } from './tools/conversation-tools.js';
import { BlogTools } from './tools/blog-tools.js';
import { OpportunityTools } from './tools/opportunity-tools.js';
import { CalendarTools } from './tools/calendar-tools.js';
import { EmailTools } from './tools/email-tools.js';
import { LocationTools } from './tools/location-tools.js';
import { EmailISVTools } from './tools/email-isv-tools.js';
import { SocialMediaTools } from './tools/social-media-tools.js';
import { MediaTools } from './tools/media-tools.js';
import { ObjectTools } from './tools/object-tools.js';
import { AssociationTools } from './tools/association-tools.js';
import { CustomFieldV2Tools } from './tools/custom-field-v2-tools.js';
import { WorkflowTools } from './tools/workflow-tools.js';
import { SurveyTools } from './tools/survey-tools.js';
import { StoreTools } from './tools/store-tools.js';
import { ProductsTools } from './tools/products-tools.js';
import { AffiliatesTools } from './tools/affiliates-tools.js';
import { BusinessesTools } from './tools/businesses-tools.js';
import { CampaignsTools } from './tools/campaigns-tools.js';
import { CompaniesTools } from './tools/companies-tools.js';
import { CoursesTools } from './tools/courses-tools.js';
import { FormsTools } from './tools/forms-tools.js';
import { FunnelsTools } from './tools/funnels-tools.js';
import { InvoicesTools } from './tools/invoices-tools.js';
import { LinksTools } from './tools/links-tools.js';
import { PaymentsTools } from './tools/payments-tools.js';
import { PhoneTools } from './tools/phone-tools.js';
import { ReportingTools } from './tools/reporting-tools.js';
import { ReputationTools } from './tools/reputation-tools.js';
import { SaasTools } from './tools/saas-tools.js';
import { SmartListsTools } from './tools/smartlists-tools.js';
import { SnapshotsTools } from './tools/snapshots-tools.js';
import { TemplatesTools } from './tools/templates-tools.js';
import { TriggersTools } from './tools/triggers-tools.js';
import { UsersTools } from './tools/users-tools.js';
import { WebhooksTools } from './tools/webhooks-tools.js';
import { WorkflowBuilderTools } from './tools/workflow-builder-tools.js';
import { PhoneSystemTools } from './tools/phone-system-tools.js';
import { VoiceAITools } from './tools/voice-ai-tools.js';
import { ProposalsTools } from './tools/proposals-tools.js';
import { CustomMenusTools } from './tools/custom-menus-tools.js';
import { MarketplaceTools } from './tools/marketplace-tools.js';
import { AgentStudioTools } from './tools/agent-studio-tools.js';
import { NotesTools } from './tools/notes-tools.js';
import { OfficialSpecTools } from './tools/official-spec-tools.js';
import { WorkflowInsightsTools } from './tools/workflow-insights-tools.js';
import { AgentWorkspaceTools } from './tools/agent-workspace-tools.js';

// ─── Types ──────────────────────────────────────────────────

interface ToolModule {
  name: string;
  instance: any;
  getTools: () => Tool[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolInventoryItem {
  name: string;
  module: string;
  description: string;
  category: string;
  access: string;
  destructive: boolean;
  readOnly: boolean;
  idempotent: boolean;
  required: string[];
  scopes: string[];
  source: string;
  method?: string;
  path?: string;
  operationId?: string;
}

type ToolProfile = 'full' | 'curated' | 'raw';

// ─── Annotation Inference ───────────────────────────────────

/**
 * Infer MCP tool annotations from tool name and metadata.
 * This classifies every tool by its HTTP method semantics.
 */
function inferAnnotations(toolName: string, meta?: any): ToolAnnotations {
  const name = toolName.toLowerCase();
  const access = meta?.labels?.access;

  // Read-only operations
  const isRead = access === 'read' ||
    name.startsWith('get_') ||
    name.startsWith('search_') ||
    name.startsWith('list_') ||
    name.startsWith('check_') ||
    name.startsWith('validate_') ||
    name.startsWith('view_') ||
    name.startsWith('ghl_get_') ||
    name.startsWith('ghl_list_') ||
    name.startsWith('get_csv_') ||
    name.startsWith('get_platform_') ||
    name.startsWith('get_blocked_') ||
    name.startsWith('download_') ||
    name.startsWith('generate_invoice_number') ||
    name.startsWith('generate_estimate_number') ||
    name === 'get_timezones' ||
    name === 'verify_email' ||
    name === 'live_chat_typing';

  // Destructive operations (DELETE)
  const isDestructive = access === 'delete' ||
    name.startsWith('delete_') ||
    name.startsWith('remove_') ||
    name.startsWith('ghl_delete_') ||
    name.startsWith('bulk_delete_') ||
    name === 'void_invoice' ||
    name === 'cancel_scheduled_message' ||
    name === 'cancel_scheduled_email' ||
    name === 'cancel_invoice_schedule';

  // Idempotent operations (GET, PUT, DELETE — same result if repeated)
  const isIdempotent = isRead ||
    name.startsWith('update_') ||
    name.startsWith('upsert_') ||
    name.startsWith('ghl_update_') ||
    name.startsWith('set_') ||
    isDestructive;

  return {
    title: toolName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    readOnlyHint: isRead,
    destructiveHint: isDestructive,
    idempotentHint: isIdempotent,
    openWorldHint: true, // All tools interact with GHL API
  };
}

function inferToolInventoryItem(tool: Tool, moduleName: string): ToolInventoryItem {
  const meta = (tool as any)._meta || {};
  const labels = meta.labels || {};
  const official = meta.official || {};
  const annotations = inferAnnotations(tool.name, meta);
  const schema = (tool as any).inputSchema || {};
  const required = Array.isArray(schema.required) ? schema.required.map(String) : [];

  return {
    name: tool.name,
    module: moduleName,
    description: tool.description || '',
    category: labels.category || moduleName,
    access: annotations.destructiveHint ? 'delete' : annotations.readOnlyHint ? 'read' : labels.access || 'write',
    destructive: Boolean(annotations.destructiveHint),
    readOnly: Boolean(annotations.readOnlyHint),
    idempotent: Boolean(annotations.idempotentHint),
    required,
    scopes: Array.isArray(official.scopes) ? official.scopes : [],
    source: labels.source || (official.operationId ? 'official-ghl-openapi' : 'local-tool-module'),
    method: official.method,
    path: official.path,
    operationId: official.operationId,
  };
}

// ─── Tool Registry ──────────────────────────────────────────

export class ToolRegistry {
  private modules: ToolModule[] = [];
  private toolToModule = new Map<string, ToolModule>();
  private allToolDefs: Tool[] = [];
  private profile: ToolProfile = readToolProfile();
  private defaultLocationId: string;

  constructor(ghlClient: GHLApiClient) {
    // The configured GHL_LOCATION_ID (or per-request override) so location-scoped
    // tools don't force the caller to repeat it on every call.
    this.defaultLocationId = ghlClient.getConfig?.().locationId || '';
    this.initModules(ghlClient);
  }

  // ─── Location-id defaulting ─────────────────────────────────
  // Many tools take a `locationId`/`location_id` that simply identifies the
  // configured sub-account. The MCP config already carries GHL_LOCATION_ID, so
  // inject it whenever a tool accepts one but the caller omitted it. Without
  // this, calls like get_location_tags hit `/locations/undefined/tags`.
  private static readonly LOCATION_KEYS = ['locationId', 'location_id'] as const;

  // Drop locationId/location_id from a schema's `required` list when we have a
  // configured default, so clients present it as optional rather than mandatory.
  private relaxLocationRequirement(schema: any): any {
    if (!this.defaultLocationId || !schema || !Array.isArray(schema.required)) return schema;
    const keys = ToolRegistry.LOCATION_KEYS as readonly string[];
    if (!schema.required.some((r: string) => keys.includes(r))) return schema;
    return { ...schema, required: schema.required.filter((r: string) => !keys.includes(r)) };
  }

  private applyLocationDefault(tool: Tool, args: Record<string, unknown>): Record<string, unknown> {
    if (!this.defaultLocationId) return args;
    const props = ((tool as any).inputSchema?.properties || {}) as Record<string, unknown>;
    let next = args;
    for (const key of ToolRegistry.LOCATION_KEYS) {
      if (!(key in props)) continue;
      const current = next[key];
      if (current === undefined || current === null || current === '') {
        next = { ...next, [key]: this.defaultLocationId };
      }
    }
    return next;
  }

  private initModules(ghl: GHLApiClient): void {
    // Legacy modules (use getToolDefinitions/getTools + executeTool)
    const contactTools = new ContactTools(ghl);
    const conversationTools = new ConversationTools(ghl);
    const blogTools = new BlogTools(ghl);
    const opportunityTools = new OpportunityTools(ghl);
    const calendarTools = new CalendarTools(ghl);
    const emailTools = new EmailTools(ghl);
    const locationTools = new LocationTools(ghl);
    const emailISVTools = new EmailISVTools(ghl);
    const socialMediaTools = new SocialMediaTools(ghl);
    const mediaTools = new MediaTools(ghl);
    const objectTools = new ObjectTools(ghl);

    // Modules with getTools/executeXxxTool pattern
    const associationTools = new AssociationTools(ghl);
    const customFieldV2Tools = new CustomFieldV2Tools(ghl);
    const workflowTools = new WorkflowTools(ghl);
    const surveyTools = new SurveyTools(ghl);
    const storeTools = new StoreTools(ghl);
    const productsTools = new ProductsTools(ghl);

    // Dynamic modules (use getToolDefinitions + handleToolCall)
    const affiliatesTools = new AffiliatesTools(ghl);
    const businessesTools = new BusinessesTools(ghl);
    const campaignsTools = new CampaignsTools(ghl);
    const companiesTools = new CompaniesTools(ghl);
    const coursesTools = new CoursesTools(ghl);
    const formsTools = new FormsTools(ghl);
    const funnelsTools = new FunnelsTools(ghl);
    const invoicesTools = new InvoicesTools(ghl);
    const linksTools = new LinksTools(ghl);
    const paymentsTools = new PaymentsTools(ghl);
    const phoneTools = new PhoneTools(ghl);
    const reportingTools = new ReportingTools(ghl);
    const reputationTools = new ReputationTools(ghl);
    const saasTools = new SaasTools(ghl);
    const smartListsTools = new SmartListsTools(ghl);
    const snapshotsTools = new SnapshotsTools(ghl);
    const templatesTools = new TemplatesTools(ghl);
    const triggersTools = new TriggersTools(ghl);
    const usersTools = new UsersTools(ghl);
    const webhooksTools = new WebhooksTools(ghl);
    const phoneSystemTools = new PhoneSystemTools(ghl);
    const voiceAITools = new VoiceAITools(ghl);
    const proposalsTools = new ProposalsTools(ghl);
    const customMenusTools = new CustomMenusTools(ghl);
    const marketplaceTools = new MarketplaceTools(ghl);
    const agentStudioTools = new AgentStudioTools(ghl);
    const notesTools = new NotesTools(ghl);
    const officialSpecTools = new OfficialSpecTools(ghl);
    const workflowInsightsTools = new WorkflowInsightsTools(ghl);
    const agentWorkspaceTools = new AgentWorkspaceTools(ghl);

    // Register legacy modules (executeTool pattern)
    this.addModule('contact', contactTools, 'getToolDefinitions', 'executeTool');
    this.addModule('conversation', conversationTools, 'getToolDefinitions', 'executeTool');
    this.addModule('blog', blogTools, 'getToolDefinitions', 'executeTool');
    this.addModule('opportunity', opportunityTools, 'getToolDefinitions', 'executeTool');
    this.addModule('calendar', calendarTools, 'getToolDefinitions', 'executeTool');
    this.addModule('email', emailTools, 'getToolDefinitions', 'executeTool');
    this.addModule('location', locationTools, 'getToolDefinitions', 'executeTool');
    this.addModule('emailISV', emailISVTools, 'getToolDefinitions', 'executeTool');
    this.addModule('socialMedia', socialMediaTools, 'getTools', 'executeTool');
    this.addModule('media', mediaTools, 'getToolDefinitions', 'executeTool');
    this.addModule('objects', objectTools, 'getToolDefinitions', 'executeTool');

    // Modules with specialized execute methods
    this.addModule('associations', associationTools, 'getTools', 'executeAssociationTool');
    this.addModule('customFieldsV2', customFieldV2Tools, 'getTools', 'executeCustomFieldV2Tool');
    this.addModule('workflows', workflowTools, 'getTools', 'executeWorkflowTool');
    this.addModule('surveys', surveyTools, 'getTools', 'executeSurveyTool');
    this.addModule('store', storeTools, 'getTools', 'executeStoreTool');
    this.addModule('products', productsTools, 'getTools', 'executeProductsTool');

    // Dynamic modules (handleToolCall pattern)
    this.addModule('affiliates', affiliatesTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('businesses', businessesTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('campaigns', campaignsTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('companies', companiesTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('courses', coursesTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('forms', formsTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('funnels', funnelsTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('invoices', invoicesTools, 'getTools', 'handleToolCall');
    this.addModule('links', linksTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('payments', paymentsTools, 'getTools', 'handleToolCall');
    this.addModule('phone', phoneTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('reporting', reportingTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('reputation', reputationTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('saas', saasTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('smartLists', smartListsTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('snapshots', snapshotsTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('templates', templatesTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('triggers', triggersTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('users', usersTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('webhooks', webhooksTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('phoneSystem', phoneSystemTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('voiceAI', voiceAITools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('proposals', proposalsTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('customMenus', customMenusTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('marketplace', marketplaceTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('agentStudio', agentStudioTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('notes', notesTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('officialSpec', officialSpecTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('workflowInsights', workflowInsightsTools, 'getToolDefinitions', 'handleToolCall');
    this.addModule('agentWorkspace', agentWorkspaceTools, 'getToolDefinitions', 'handleToolCall');

    // Workflow Builder — internal API with Firebase auth (no GHL API client dependency)
    const workflowBuilderTools = new WorkflowBuilderTools();
    this.addModule('workflowBuilder', workflowBuilderTools, 'getTools', 'executeWorkflowBuilderTool');
  }

  private addModule(
    name: string,
    instance: any,
    listMethod: string,
    executeMethod: string
  ): void {
    const getTools = () => instance[listMethod]() as Tool[];
    const executeTool = (toolName: string, args: Record<string, unknown>) =>
      instance[executeMethod](toolName, args);

    const mod: ToolModule = { name, instance, getTools, executeTool };
    this.modules.push(mod);

    // Index tools by name
    try {
      const tools = getTools();
      for (const tool of tools) {
        this.toolToModule.set(tool.name, mod);
        this.allToolDefs.push(tool);
      }
    } catch (err: any) {
      process.stderr.write(`[Registry] Warning: Failed to load tools from ${name}: ${err.message}\n`);
    }
  }

  // ─── Tool-name capping ──────────────────────────────────────
  // MCP clients reject tool names > 64 chars and reject duplicates. We expose a
  // capped, de-duplicated name per tool-def (stable within a process) on BOTH the
  // stdio path (getAllToolDefinitions) and the HTTP path (registerAll), and reverse
  // it in callTool() so execution still dispatches on the original internal name.
  private defToExposed = new Map<Tool, string>();
  private exposedToOriginal = new Map<string, string>();
  private nameMapsBuilt = false;

  private capName(name: string, used: Set<string>): string {
    // The 64-char limit on some surfaces applies to the NAMESPACED name
    // (e.g. "mcp__ghlcrm__<tool>"), so cap the bare name well under 64 to leave
    // room for the prefix. 50 covers a "mcp__<=9char>__" prefix.
    const MAX = 50;
    let candidate = name.length <= MAX ? name : name.slice(0, MAX);
    if (!used.has(candidate)) return candidate;
    for (let i = 0; ; i++) {
      const suffix = '_' + i.toString(36);
      candidate = name.slice(0, MAX - suffix.length) + suffix;
      if (!used.has(candidate)) return candidate;
    }
  }

  private ensureNameMaps(): void {
    if (this.nameMapsBuilt) return;
    const used = new Set<string>();
    for (const tool of this.allToolDefs) {
      const exposed = this.capName(tool.name, used);
      used.add(exposed);
      this.defToExposed.set(tool, exposed);
      this.exposedToOriginal.set(exposed, tool.name);
    }
    this.nameMapsBuilt = true;
  }

  private exposedName(tool: Tool): string {
    this.ensureNameMaps();
    return this.defToExposed.get(tool) ?? tool.name;
  }

  /**
   * Register all tools with a McpServer instance (HTTP path)
   */
  registerAll(server: McpServer): number {
    let count = 0;

    for (const tool of this.visibleToolDefs()) {
      const mod = this.toolToModule.get(tool.name);
      if (!mod) continue;

      const meta = (tool as any)._meta;
      const annotations = inferAnnotations(tool.name, meta);
      const exposedName = this.exposedName(tool);

      try {
        server.registerTool(
          exposedName,
          {
            title: annotations.title,
            description: tool.description || '',
            annotations,
            _meta: meta,
          },
          async (args: any) => {
            try {
              const result = await mod.executeTool(tool.name, this.applyLocationDefault(tool, args || {}));
              // Normalize result to MCP format
              const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
              return {
                content: [{ type: 'text' as const, text }],
              };
            } catch (err: any) {
              return {
                content: [{ type: 'text' as const, text: `Error executing ${tool.name}: ${err.message}` }],
                isError: true,
              };
            }
          }
        );
        count++;
      } catch (err: any) {
        process.stderr.write(`[Registry] Failed to register tool ${tool.name}: ${err.message}\n`);
      }
    }

    return count;
  }

  /**
   * Call a tool directly (for REST endpoint)
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.ensureNameMaps();
    // Accept either the exposed (capped) name or the original internal name.
    const original = this.exposedToOriginal.get(name) ?? name;
    const mod = this.toolToModule.get(original);
    if (!mod) return undefined;
    if (!this.isToolVisible(original)) return undefined;
    const tool = this.allToolDefs.find((item) => item.name === original);
    return mod.executeTool(original, tool ? this.applyLocationDefault(tool, args) : args);
  }

  /**
   * Get tool counts by category (for REST /)
   */
  getToolCounts(): Record<string, number | Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const mod of this.modules) {
      try {
        counts[mod.name] = mod.getTools().filter((tool) => this.isToolVisible(tool.name)).length;
      } catch {
        counts[mod.name] = 0;
      }
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return {
      ...counts,
      total,
      sections: Object.keys(counts).length,
    };
  }

  /**
   * Get all tool definitions (for REST /tools endpoint)
   */
  getAllToolDefinitions(): Tool[] {
    // Serve a <=64-char, de-duplicated name to MCP clients (stdio path);
    // callTool() reverses it back to the original for execution.
    return this.visibleToolDefs().map(tool => {
      const meta = (tool as any)._meta;
      const annotations = inferAnnotations(tool.name, meta);
      return {
        ...tool,
        name: this.exposedName(tool),
        inputSchema: this.relaxLocationRequirement((tool as any).inputSchema),
        annotations,
      };
    });
  }

  getToolInventory(): ToolInventoryItem[] {
    return this.visibleToolDefs().map((tool) => {
      const mod = this.toolToModule.get(tool.name);
      return inferToolInventoryItem(tool, mod?.name || 'unknown');
    });
  }

  /**
   * Get count of registered GHL tools (excluding apps)
   */
  getToolCount(): number {
    return this.visibleToolDefs().length;
  }

  /**
   * Get all registered tool names
   */
  getAllToolNames(): string[] {
    return this.visibleToolDefs().map(t => t.name);
  }

  getToolProfile(): ToolProfile {
    return this.profile;
  }

  private visibleToolDefs(): Tool[] {
    return this.allToolDefs.filter((tool) => this.isToolVisible(tool.name));
  }

  private isToolVisible(name: string): boolean {
    const tool = this.allToolDefs.find((item) => item.name === name);
    if (!tool) return false;
    const category = ((tool as any)._meta?.labels?.category || '').toString();
    const source = ((tool as any)._meta?.labels?.source || '').toString();
    const isCurated = category === 'agent-workspace' || source === 'curated-agent-workspace';
    if (this.profile === 'curated') return isCurated;
    if (this.profile === 'raw') return !isCurated;
    return true;
  }
}

// All tool registration is handled via the ToolRegistry class above.

function readToolProfile(): ToolProfile {
  const value = (process.env.GHL_TOOL_PROFILE || 'full').toLowerCase();
  if (value === 'curated' || value === 'raw' || value === 'full') return value;
  process.stderr.write(`[Registry] Unknown GHL_TOOL_PROFILE=${value}; using full.\n`);
  return 'full';
}
