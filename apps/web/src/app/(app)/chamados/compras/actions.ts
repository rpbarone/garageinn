"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import {
  GERENTE_APPROVAL_STATUS,
  statusLabels,
  statusTransitions,
  getTransitionPermission,
} from "./constants";
import { hasPermission } from "@/lib/auth/rbac";
import type { Permission } from "@/lib/auth/permissions";
import type { ApprovalDecision, ApprovalFlowStatus } from "@/lib/ticket-statuses";
import { APPROVAL_FLOW_STATUS } from "@/lib/ticket-statuses";

// ============================================
// Types
// ============================================

/**
 * Status de aprovação hierárquica para chamados de compras
 * Baseado no nível do usuário em Operações:
 * - Manobrista (1) → awaiting_approval_encarregado
 * - Encarregado (2) → awaiting_approval_supervisor
 * - Supervisor (3) → awaiting_approval_gerente
 * - Gerente (4) → awaiting_triage
 */

export interface TicketFilters {
  status?: string;
  priority?: string;
  category_id?: string;
  unit_id?: string;
  assigned_to?: string;
  parent_ticket_id?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface TicketStats {
  total: number;
  awaitingTriage: number;
  inProgress: number;
  closed: number;
}

export interface PurchaseCategory {
  id: string;
  name: string;
  department_id: string;
  status: string;
}

export interface UserUnit {
  id: string;
  name: string;
  code: string;
}

export interface PurchaseItemInput {
  item_name: string;
  quantity: number;
  unit_of_measure?: string | null;
  estimated_price?: number | null;
}

export interface PurchaseItem {
  id?: string;
  ticket_id?: string;
  item_name: string;
  quantity: number;
  unit_of_measure: string | null;
  estimated_price: number | null;
  sort_order?: number | null;
}

interface RoleInfo {
  name: string;
  departmentName: string | null;
  isGlobal: boolean;
}

type RoleQueryItem = {
  name: string;
  is_global: boolean | null;
  department: { name: string } | { name: string }[] | null;
};

interface RoleQueryRow {
  role: RoleQueryItem | RoleQueryItem[] | null;
}

interface PurchaseVisibilityFilter {
  excludedStatuses: string[];
  allowedUnitIds: string[] | null;
}

const OPERACOES_DEPARTMENT = "Operações";
const COMPRAS_DEPARTMENT = "Compras e Manutenção";
const UNIT_RESTRICTED_ROLES = [
  "Manobrista",
  "Encarregado",
  "Supervisor",
  "Gerente",
];

function formatInFilter(values: string[]) {
  return `(${values.map((value) => `"${value}"`).join(",")})`;
}

async function ensureOperacoesGerenteApproval(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ticketId: string,
  approvalLevel?: number | null,
  approvalRole?: string | null
) {
  if (approvalLevel !== 3 && approvalRole !== "Gerente") {
    return null;
  }

  const { data: ticket, error: ticketError } = await supabase
    .from("tickets")
    .select("created_by")
    .eq("id", ticketId)
    .single();

  if (ticketError || !ticket) {
    console.error("Error fetching ticket creator:", ticketError);
    return { error: "Nao foi possivel validar o criador do chamado", code: "conflict" };
  }

  const { data: isOpsCreator, error: creatorError } = await supabase.rpc(
    "is_operacoes_creator",
    {
      p_user_id: ticket.created_by,
    }
  );

  if (creatorError) {
    console.error("Error checking operations creator:", creatorError);
    return { error: "Nao foi possivel validar permissoes de aprovacao", code: "conflict" };
  }

  if (!isOpsCreator) {
    return null;
  }

  const { data: isOpsManager, error: managerError } = await supabase.rpc(
    "is_operacoes_gerente"
  );

  if (managerError) {
    console.error("Error checking operations manager:", managerError);
    return { error: "Nao foi possivel validar permissoes de aprovacao", code: "conflict" };
  }

  if (!isOpsManager) {
    return { error: "Apenas o gerente de operacoes pode aprovar este chamado", code: "forbidden" };
  }

  return null;
}

async function ensureComprasPurchaseApproval(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ticketId: string,
  approvalRole?: string | null
) {
  if (approvalRole !== "Gerente") {
    return null;
  }

  const { data: ticket, error: ticketError } = await supabase
    .from("tickets")
    .select("created_by")
    .eq("id", ticketId)
    .single();

  if (ticketError || !ticket) {
    console.error("Error fetching ticket creator:", ticketError);
    return { error: "Não foi possível validar o criador do chamado", code: "conflict" };
  }

  const { data: requiredApprover, error: approverError } = await supabase.rpc(
    "get_purchase_approver",
    { p_created_by: ticket.created_by }
  );

  if (approverError) {
    console.error("Error checking purchase approver:", approverError);
    return { error: "Não foi possível validar permissões de aprovação", code: "conflict" };
  }

  if (requiredApprover !== "Diretor") {
    return null;
  }

  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin) {
    return null;
  }

  return { error: "Chamados de Gerentes devem ser aprovados pelo Diretor", code: "forbidden" };
}

// ============================================
// Query Functions
// ============================================

/**
 * Obtém roles do usuário com departamento
 */
async function getUserRoles(): Promise<RoleInfo[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("user_roles")
    .select(
      `
      role:roles!role_id(
        name,
        is_global,
        department:departments(name)
      )
    `
    )
    .eq("user_id", user.id);

  if (error) {
    console.error("Error fetching user roles:", error);
    return [];
  }

  const rows = (data ?? []) as RoleQueryRow[];

  return rows
    .flatMap((row) => {
      if (!row.role) return [];
      return Array.isArray(row.role) ? row.role : [row.role];
    })
    .map((role) => {
      const department = Array.isArray(role.department)
        ? role.department[0] ?? null
        : role.department;

      return {
        name: role.name,
        isGlobal: role.is_global ?? false,
        departmentName: department?.name ?? null,
      };
    });
}

/**
 * Regras de visibilidade baseadas em perfil/unidade
 */
async function buildPurchaseVisibilityFilter(): Promise<PurchaseVisibilityFilter> {
  const roles = await getUserRoles();
  const isGlobal = roles.some((role) => role.isGlobal);

  const isAssistenteCompras = roles.some(
    (role) =>
      role.departmentName === COMPRAS_DEPARTMENT && role.name === "Assistente"
  );
  const hasGerenteRole = roles.some((role) => role.name === "Gerente");

  const hasUnitRestrictedOperacoesRole = roles.some(
    (role) =>
      role.departmentName === OPERACOES_DEPARTMENT &&
      UNIT_RESTRICTED_ROLES.includes(role.name)
  );

  const excludedStatuses =
    !isGlobal && isAssistenteCompras && !hasGerenteRole
      ? [GERENTE_APPROVAL_STATUS]
      : [];

  let allowedUnitIds: string[] | null = null;
  if (!isGlobal && hasUnitRestrictedOperacoesRole) {
    const units = await getUserUnits();
    allowedUnitIds = units.map((unit) => unit.id);
  }

  return { excludedStatuses, allowedUnitIds };
}

/**
 * Busca departamento de Compras e Manutenção
 */
async function getComprasDepartment() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("departments")
    .select("id")
    .eq("name", "Compras e Manutenção")
    .single();

  if (error) {
    console.error("Error fetching Compras department:", error);
    return null;
  }

  return data;
}

/**
 * Lista categorias de Compras
 */
export async function getPurchaseCategories(): Promise<PurchaseCategory[]> {
  const supabase = await createClient();

  const comprasDept = await getComprasDepartment();
  if (!comprasDept) return [];

  const { data, error } = await supabase
    .from("ticket_categories")
    .select("*")
    .eq("department_id", comprasDept.id)
    .eq("status", "active")
    .order("name");

  if (error) {
    console.error("Error fetching categories:", error);
    return [];
  }

  return data || [];
}

/**
 * Obtém unidades acessíveis ao usuário atual
 *
 * Regras de acesso (implementadas na RPC get_user_accessible_units):
 * - Admin/Desenvolvedor/Diretor: todas as unidades
 * - Gerente: todas as unidades
 * - Supervisor: unidades vinculadas (múltiplas, is_coverage = true)
 * - Manobrista/Encarregado: unidade vinculada (única)
 */
export async function getUserUnits(): Promise<UserUnit[]> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  // Usar RPC que centraliza a lógica de acesso por role
  const { data, error } = await supabase.rpc("get_user_accessible_units");

  if (error) {
    console.error("Error fetching accessible units:", error);
    return [];
  }

  return data || [];
}

/**
 * Verifica se o usuário tem unidade fixa (Manobrista/Encarregado)
 * Retorna a unidade se única e role for de unidade fixa, null caso contrário
 */
export async function getUserFixedUnit(): Promise<UserUnit | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Verificar se tem role de unidade fixa (Manobrista ou Encarregado)
  const { data: userRoles } = await supabase
    .from("user_roles")
    .select("role:roles(name)")
    .eq("user_id", user.id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasFixedUnitRole = userRoles?.some((ur: any) =>
    ["Manobrista", "Encarregado"].includes(ur.role?.name)
  );

  if (!hasFixedUnitRole) return null;

  // Buscar unidade única (não coverage)
  const { data: units } = await supabase
    .from("user_units")
    .select("unit:units(id, name, code)")
    .eq("user_id", user.id)
    .eq("is_coverage", false)
    .limit(1);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (units?.[0] as any)?.unit || null;
}

/**
 * Lista chamados de Compras com filtros
 */
export async function getPurchaseTickets(filters?: TicketFilters) {
  const supabase = await createClient();

  const page = filters?.page || 1;
  const limit = filters?.limit || 20;
  const offset = (page - 1) * limit;

  const comprasDept = await getComprasDepartment();
  if (!comprasDept) return { data: [], count: 0, page, limit };

  const visibility = await buildPurchaseVisibilityFilter();
  if (
    visibility.excludedStatuses.length > 0 &&
    filters?.status &&
    visibility.excludedStatuses.includes(filters.status)
  ) {
    return { data: [], count: 0, page, limit };
  }

  if (visibility.allowedUnitIds && visibility.allowedUnitIds.length === 0) {
    return { data: [], count: 0, page, limit };
  }

  let query = supabase
    .from("tickets_with_details")
    .select("*", { count: "exact" })
    .eq("department_id", comprasDept.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (filters?.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  if (filters?.priority && filters.priority !== "all") {
    query = query.eq("priority", filters.priority);
  }

  if (filters?.category_id && filters.category_id !== "all") {
    query = query.eq("category_id", filters.category_id);
  }

  if (filters?.unit_id && filters.unit_id !== "all") {
    query = query.eq("unit_id", filters.unit_id);
  }

  if (filters?.assigned_to && filters.assigned_to !== "all") {
    query = query.eq("assigned_to_id", filters.assigned_to);
  }

  if (filters?.parent_ticket_id) {
    const raw = filters.parent_ticket_id.trim();
    let parentId: string | null = raw;

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(raw)) {
      const ticketNumber = parseInt(raw.replace(/^#/, ""), 10);
      if (!isNaN(ticketNumber)) {
        const { data: parentTicket } = await supabase
          .from("tickets")
          .select("id")
          .eq("ticket_number", ticketNumber)
          .limit(1)
          .maybeSingle();
        parentId = parentTicket?.id ?? null;
      }
    }

    query = query.eq(
      "parent_ticket_id",
      parentId ?? "00000000-0000-0000-0000-000000000000"
    );
  }

  if (filters?.search) {
    const searchTerm = filters.search.trim();
    const ticketNumber = parseInt(searchTerm.replace("#", ""));

    if (!isNaN(ticketNumber)) {
      query = query.or(
        `title.ilike.%${searchTerm}%,ticket_number.eq.${ticketNumber}`
      );
    } else {
      query = query.ilike("title", `%${searchTerm}%`);
    }
  }

  if (filters?.startDate) {
    query = query.gte("created_at", `${filters.startDate}T00:00:00`);
  }

  if (filters?.endDate) {
    query = query.lte("created_at", `${filters.endDate}T23:59:59`);
  }

  if (visibility.allowedUnitIds) {
    query = query.in("unit_id", visibility.allowedUnitIds);
  }

  if (visibility.excludedStatuses.length === 1) {
    query = query.neq("status", visibility.excludedStatuses[0]);
  } else if (visibility.excludedStatuses.length > 1) {
    query = query.not(
      "status",
      "in",
      formatInFilter(visibility.excludedStatuses)
    );
  }

  const { data, error, count } = await query;

  if (error) {
    console.error("Error fetching tickets:", error);
    return { data: [], count: 0, page, limit };
  }

  const tickets = data || [];
  const ticketIds = tickets
    .map((ticket) => ticket.id)
    .filter((id): id is string => Boolean(id));

  const itemsByTicketId = new Map<string, PurchaseItem[]>();
  if (ticketIds.length > 0) {
    const { data: items } = await supabase
      .from("ticket_purchase_items")
      .select(
        "id, ticket_id, item_name, quantity, unit_of_measure, estimated_price, sort_order, created_at"
      )
      .in("ticket_id", ticketIds)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    (items || []).forEach((item) => {
      if (!item.ticket_id) return;
      const entry = itemsByTicketId.get(item.ticket_id) || [];
      entry.push({
        id: item.id ?? undefined,
        ticket_id: item.ticket_id ?? undefined,
        item_name: item.item_name,
        quantity: item.quantity,
        unit_of_measure: item.unit_of_measure ?? null,
        estimated_price: item.estimated_price ?? null,
        sort_order: item.sort_order ?? 0,
      });
      itemsByTicketId.set(item.ticket_id, entry);
    });
  }

  const enrichedTickets = tickets.map((ticket) => {
    const itemsFromTable = ticket.id
      ? itemsByTicketId.get(ticket.id) || []
      : [];
    const fallbackItems =
      itemsFromTable.length > 0 || !ticket.item_name
        ? []
        : [
            {
              item_name: ticket.item_name,
              quantity: ticket.quantity || 0,
              unit_of_measure: ticket.unit_of_measure || "un",
              estimated_price: ticket.estimated_price ?? null,
            },
          ];
    const items = itemsFromTable.length > 0 ? itemsFromTable : fallbackItems;
    const itemsCount = items.length;
    const itemsTotalQuantity = items.reduce(
      (sum, item) => sum + (item.quantity || 0),
      0
    );
    const summary =
      items.length === 0
        ? null
        : items.length === 1
          ? `${items[0].item_name} (${items[0].quantity} ${items[0].unit_of_measure || "un"})`
          : `${items[0].item_name} (${items[0].quantity} ${items[0].unit_of_measure || "un"}) + ${items.length - 1} itens`;

    return {
      ...ticket,
      items,
      items_count: itemsCount,
      items_total_quantity: itemsTotalQuantity,
      items_summary: summary,
    };
  });

  return { data: enrichedTickets, count: count || 0, page, limit };
}

/**
 * Estatísticas de Chamados de Compras
 */
export async function getPurchaseStats(): Promise<TicketStats> {
  const supabase = await createClient();

  const comprasDept = await getComprasDepartment();
  if (!comprasDept) {
    return { total: 0, awaitingTriage: 0, inProgress: 0, closed: 0 };
  }

  const visibility = await buildPurchaseVisibilityFilter();

  if (visibility.allowedUnitIds && visibility.allowedUnitIds.length === 0) {
    return { total: 0, awaitingTriage: 0, inProgress: 0, closed: 0 };
  }

  let query = supabase
    .from("tickets")
    .select("status, unit_id")
    .eq("department_id", comprasDept.id);

  if (visibility.allowedUnitIds) {
    query = query.in("unit_id", visibility.allowedUnitIds);
  }

  if (visibility.excludedStatuses.length === 1) {
    query = query.neq("status", visibility.excludedStatuses[0]);
  } else if (visibility.excludedStatuses.length > 1) {
    query = query.not(
      "status",
      "in",
      formatInFilter(visibility.excludedStatuses)
    );
  }

  const { data } = await query;

  if (!data) {
    return { total: 0, awaitingTriage: 0, inProgress: 0, closed: 0 };
  }

  const closedStatuses = ["closed", "cancelled", "denied"];
  const triageStatuses = [
    "awaiting_triage",
    "awaiting_approval_encarregado",
    "awaiting_approval_supervisor",
    "awaiting_approval_gerente",
  ];

  return {
    total: data.length,
    awaitingTriage: data.filter((t) => triageStatuses.includes(t.status))
      .length,
    inProgress: data.filter(
      (t) =>
        !closedStatuses.includes(t.status) && !triageStatuses.includes(t.status)
    ).length,
    closed: data.filter((t) => closedStatuses.includes(t.status)).length,
  };
}

/**
 * Busca um chamado por ID
 */
export async function getTicketById(ticketId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tickets_with_details")
    .select("*")
    .eq("id", ticketId)
    .single();

  if (error) {
    console.error("Error fetching ticket:", error);
    return null;
  }

  return data;
}

// ============================================
// Mutation Functions
// ============================================

/**
 * Cria um chamado de Compras
 */
export async function createPurchaseTicket(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Não autenticado", code: "forbidden" };
  }

  // Obter departamento de Compras
  const comprasDept = await getComprasDepartment();
  if (!comprasDept) {
    return { error: "Departamento de Compras não encontrado", code: "not_found" };
  }

  // Extrair dados do formulário
  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const category_id = formData.get("category_id") as string | null;
  const unit_id = formData.get("unit_id") as string | null;
  const perceived_urgency = formData.get("perceived_urgency") as string | null;
  const itemsRaw = formData.get("items");
  let rawItems: PurchaseItemInput[] = [];
  if (typeof itemsRaw === "string" && itemsRaw.trim()) {
    try {
      rawItems = JSON.parse(itemsRaw) as PurchaseItemInput[];
    } catch (error) {
      console.error("Error parsing items payload:", error);
      return { error: "Lista de itens inválida. Recarregue a página e tente novamente.", code: "validation" };
    }
  }

  if (rawItems.length === 0) {
    const fallbackItemName = formData.get("item_name") as string;
    const fallbackQuantity = parseInt(formData.get("quantity") as string);
    const fallbackUnitOfMeasure =
      (formData.get("unit_of_measure") as string) || "un";
    const fallbackEstimatedPrice = formData.get("estimated_price")
      ? parseFloat(formData.get("estimated_price") as string)
      : null;

    rawItems = [
      {
        item_name: fallbackItemName,
        quantity: fallbackQuantity,
        unit_of_measure: fallbackUnitOfMeasure,
        estimated_price: fallbackEstimatedPrice,
      },
    ];
  }

  const normalizedItems: PurchaseItem[] = rawItems.map((item, index) => ({
    item_name: (item.item_name || "").trim(),
    quantity: Number(item.quantity),
    unit_of_measure: item.unit_of_measure
      ? String(item.unit_of_measure)
      : "un",
    estimated_price:
      item.estimated_price !== undefined && item.estimated_price !== null
        ? Number(item.estimated_price)
        : null,
    sort_order: index,
  }));

  // Validações
  if (!title || title.length < 5) {
    return { error: "Título deve ter pelo menos 5 caracteres", code: "validation" };
  }
  if (!normalizedItems.length) {
    return { error: "Adicione pelo menos um item para compra", code: "validation" };
  }
  for (const [index, item] of normalizedItems.entries()) {
    if (!item.item_name || item.item_name.length < 3) {
      return {
        error: `Nome do item ${index + 1} deve ter pelo menos 3 caracteres`,
        code: "validation",
      };
    }
    if (!item.quantity || item.quantity <= 0) {
      return { error: `Quantidade do item ${index + 1} deve ser maior que zero`, code: "validation" };
    }
    if (item.estimated_price !== null) {
      if (Number.isNaN(item.estimated_price) || item.estimated_price <= 0) {
        return {
          error: `Preço estimado do item ${index + 1} deve ser maior que zero`,
          code: "validation",
        };
      }
    }
  }
  if (!description || description.length < 10) {
    return { error: "Justificativa deve ter pelo menos 10 caracteres", code: "validation" };
  }

  // Verificar se precisa de aprovação e obter status inicial baseado no cargo
  const { data: needsApproval, error: needsApprovalError } = await supabase.rpc(
    "ticket_needs_approval",
    {
      p_created_by: user.id,
      p_department_id: comprasDept.id,
    }
  );

  if (needsApprovalError) {
    console.error("Error checking approval requirement:", needsApprovalError);
  }

  // Usar função SQL que determina o status inicial correto baseado na hierarquia
  const { data: initialStatusData, error: statusError } = await supabase.rpc(
    "get_initial_approval_status",
    { p_created_by: user.id }
  );

  if (statusError) {
    console.error("Error getting initial approval status:", statusError);
    // Fallback seguro: exigir cadeia completa de aprovação
    return { error: "Falha ao determinar status de aprovação. Tente novamente.", code: "conflict" };
  }

  // Log para debug - pode ser removido após validação
  console.log("Initial status RPC response:", {
    userId: user.id,
    initialStatusData,
    statusError,
  });

  // Usar o valor retornado ou fallback seguro (exige aprovação completa)
  const initialStatus: ApprovalFlowStatus =
    (initialStatusData as ApprovalFlowStatus) ||
    APPROVAL_FLOW_STATUS.awaitingApprovalEncarregado;

  // Criar ticket
  const { data: ticket, error: ticketError } = await supabase
    .from("tickets")
    .insert({
      title,
      description,
      department_id: comprasDept.id,
      category_id: category_id && category_id !== "" ? category_id : null,
      unit_id: unit_id && unit_id !== "" ? unit_id : null,
      created_by: user.id,
      status: initialStatus,
      perceived_urgency:
        perceived_urgency && perceived_urgency !== ""
          ? perceived_urgency
          : null,
    })
    .select()
    .single();

  if (ticketError) {
    console.error("Error creating ticket:", ticketError);
    return { error: ticketError.message, code: "conflict" };
  }

  const summaryItem = normalizedItems[0];

  // Criar detalhes de compra (mantido para compatibilidade)
  const { error: detailsError } = await supabase
    .from("ticket_purchase_details")
    .insert({
      ticket_id: ticket.id,
      item_name: summaryItem.item_name,
      quantity: summaryItem.quantity,
      unit_of_measure: summaryItem.unit_of_measure,
      estimated_price: summaryItem.estimated_price,
    });

  if (detailsError) {
    console.error("Error creating purchase details:", detailsError);
    // Rollback: deletar ticket
    await supabase.from("tickets").delete().eq("id", ticket.id);
    return { error: detailsError.message, code: "conflict" };
  }

  // Criar itens de compra
  const { error: itemsError } = await supabase
    .from("ticket_purchase_items")
    .insert(
      normalizedItems.map((item) => ({
        ticket_id: ticket.id,
        item_name: item.item_name,
        quantity: item.quantity,
        unit_of_measure: item.unit_of_measure,
        estimated_price: item.estimated_price,
        sort_order: item.sort_order ?? 0,
      }))
    );

  if (itemsError) {
    console.error("Error creating purchase items:", itemsError);
    await supabase.from("tickets").delete().eq("id", ticket.id);
    return { error: itemsError.message, code: "conflict" };
  }

  // Se precisa aprovação, criar registros de aprovação
  if (needsApproval) {
    await supabase.rpc("create_ticket_approvals", { p_ticket_id: ticket.id });
  }

  revalidatePath("/chamados/compras");
  redirect(`/chamados/compras/${ticket.id}`);
}

/**
 * Verifica se o usuário atual é admin
 */
export async function checkIsAdmin(): Promise<boolean> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("is_admin");

  if (error) {
    console.error("Error checking admin status:", error);
    return false;
  }

  return data === true;
}

/**
 * Verifica se o usuário atual é Gerente (qualquer departamento)
 */
export async function checkIsGerente(): Promise<boolean> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: userRoles } = await supabase
    .from("user_roles")
    .select(
      `
      role:roles!role_id(name)
    `
    )
    .eq("user_id", user.id);

  interface RoleQueryData {
    role:
      | {
          name: string;
        }
      | {
          name: string;
        }[]
      | null;
  }

  const hasGerenteRole = (userRoles as RoleQueryData[] | null)?.some((ur) => {
    const role = Array.isArray(ur.role) ? ur.role[0] : ur.role;
    return role?.name === "Gerente";
  });

  return hasGerenteRole || false;
}

/**
 * Obtém usuário atual
 */
export async function getCurrentUser() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return profile;
}

/**
 * Obtém permissões do usuário atual
 */
export async function getCurrentUserPermissions() {
  const { extractPermissionsFromUserRoles } = await import("@/lib/auth/rbac");
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: userRoles } = await supabase
    .from("user_roles")
    .select(
      `
      role:roles!role_id(
        name,
        is_global,
        department:departments(name)
      )
    `
    )
    .eq("user_id", user.id);

  if (!userRoles) return [];

  // Normalizar formato: department pode vir como array ou objeto único
  const normalizedRoles = userRoles.map((ur) => {
    // role pode vir como array ou objeto único do Supabase
    const roleData = Array.isArray(ur.role) ? ur.role[0] : ur.role;
    if (!roleData) return { role: null };
    
    // Se department é array, pegar o primeiro elemento
    const department = Array.isArray(roleData.department)
      ? roleData.department[0] ?? null
      : roleData.department;
    
    return {
      role: {
        name: roleData.name,
        is_global: roleData.is_global,
        department: department ? { name: department.name } : null,
      },
    };
  });

  return extractPermissionsFromUserRoles(normalizedRoles);
}

// ============================================
// Ticket Details Functions
// ============================================

/**
 * Busca detalhes completos do chamado com cotações, aprovações, etc.
 */
export async function getTicketDetails(ticketId: string) {
  const supabase = await createClient();

  // Buscar ticket com detalhes
  const { data: ticket, error: ticketError } = await supabase
    .from("tickets_with_details")
    .select("*")
    .eq("id", ticketId)
    .single();

  if (ticketError || !ticket) {
    console.error("Error fetching ticket details:", ticketError);
    return null;
  }

  const visibility = await buildPurchaseVisibilityFilter();
  if (visibility.allowedUnitIds && visibility.allowedUnitIds.length === 0) {
    return { accessDenied: true as const };
  }

  if (
    visibility.allowedUnitIds &&
    ticket.unit_id &&
    !visibility.allowedUnitIds.includes(ticket.unit_id)
  ) {
    return { accessDenied: true as const };
  }

  if (
    ticket.status &&
    visibility.excludedStatuses.includes(ticket.status)
  ) {
    return { accessDenied: true as const };
  }

  // Buscar dados em paralelo (cotações, aprovações, comentários, histórico, anexos, parent ticket)
  const parentTicketQuery =
    (ticket as { parent_ticket_id?: string | null }).parent_ticket_id
      ? supabase
          .from("tickets")
          .select(
            "id, ticket_number, title, status, department:departments!department_id(name)"
          )
          .eq(
            "id",
            (ticket as { parent_ticket_id: string }).parent_ticket_id
          )
          .single()
      : Promise.resolve({ data: null });

  const [
    { data: quotations },
    { data: approvals },
    { data: comments },
    { data: history },
    { data: attachments },
    { data: items },
    { data: parentTicketRow },
  ] = await Promise.all([
    supabase
      .from("ticket_quotations")
      .select(
        `
        *,
        creator:profiles!created_by(id, full_name, avatar_url)
      `
      )
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false }),
    supabase
      .from("ticket_approvals")
      .select(
        `
        *,
        approver:profiles!approved_by(id, full_name, avatar_url)
      `
      )
      .eq("ticket_id", ticketId)
      .order("approval_level", { ascending: true }),
    supabase
      .from("ticket_comments")
      .select(
        `
        *,
        author:profiles!user_id(id, full_name, avatar_url)
      `
      )
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true }),
    supabase
      .from("ticket_history")
      .select(
        `
        *,
        user:profiles!user_id(id, full_name, avatar_url)
      `
      )
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false }),
    supabase
      .from("ticket_attachments")
      .select(
        `
        *,
        uploader:profiles!uploaded_by(id, full_name, avatar_url)
      `
      )
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false }),
    supabase
      .from("ticket_purchase_items")
      .select(
        "id, ticket_id, item_name, quantity, unit_of_measure, estimated_price, sort_order, created_at"
      )
      .eq("ticket_id", ticketId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    parentTicketQuery,
  ]);

  // Normalizar parent_ticket
  const parentTicket =
    parentTicketRow &&
    typeof parentTicketRow === "object" &&
    "id" in parentTicketRow &&
    "ticket_number" in parentTicketRow
      ? {
          id: parentTicketRow.id,
          ticket_number: parentTicketRow.ticket_number,
          title: parentTicketRow.title,
          status: parentTicketRow.status,
          department_name: (() => {
            const dept = (parentTicketRow as { department?: { name?: string } | { name?: string }[] }).department;
            if (Array.isArray(dept)) return dept[0]?.name ?? "";
            return dept?.name ?? "";
          })(),
        }
      : null;

  const normalizedItems: PurchaseItem[] =
    items && items.length > 0
      ? items.map((item) => ({
          id: item.id ?? undefined,
          ticket_id: item.ticket_id ?? undefined,
          item_name: item.item_name,
          quantity: item.quantity,
          unit_of_measure: item.unit_of_measure ?? null,
          estimated_price: item.estimated_price ?? null,
          sort_order: item.sort_order ?? 0,
        }))
      : ticket.item_name
        ? [
            {
              item_name: ticket.item_name,
              quantity: ticket.quantity || 0,
              unit_of_measure: ticket.unit_of_measure || "un",
              estimated_price: ticket.estimated_price ?? null,
            },
          ]
        : [];

  const itemsTotalQuantity = normalizedItems.reduce(
    (sum, item) => sum + (item.quantity || 0),
    0
  );

  // Buscar detalhes de entrega
  const { data: purchaseDetails } = await supabase
    .from("ticket_purchase_details")
    .select(
      "delivery_date, delivery_address, delivery_notes, delivery_confirmed_at, delivery_rating"
    )
    .eq("ticket_id", ticketId)
    .single();

  return {
    ...ticket,
    quotations: quotations || [],
    approvals: approvals || [],
    comments: comments || [],
    history: history || [],
    attachments: attachments || [],
    items: normalizedItems,
    items_count: normalizedItems.length,
    items_total_quantity: itemsTotalQuantity,
    purchase_details: purchaseDetails ?? null,
    parent_ticket: parentTicket,
  };
}

// ============================================
// Delivery Functions
// ============================================

/**
 * Registra informações de entrega e muda status para 'in_delivery'
 */
export async function registerDelivery(ticketId: string, formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Não autenticado", code: "forbidden" };
  }

  const canManage = await canManageTicket(ticketId);
  if (!canManage) {
    return { error: "Apenas membros de Compras podem registrar entregas", code: "forbidden" };
  }

  const { data: ticket } = await supabase
    .from("tickets")
    .select("status")
    .eq("id", ticketId)
    .single();

  if (!ticket) {
    return { error: "Chamado não encontrado", code: "not_found" };
  }

  if (ticket.status !== "purchasing") {
    return {
      error: "Chamado não está no status 'Executando Compra'",
      code: "conflict",
    };
  }

  const delivery_date = formData.get("delivery_date") as string | null;
  const delivery_address = formData.get("delivery_address") as string | null;
  const delivery_notes = formData.get("delivery_notes") as string | null;

  if (!delivery_date) {
    return { error: "Data prevista de entrega é obrigatória", code: "validation" };
  }

  const { error: upsertError } = await supabase
    .from("ticket_purchase_details")
    .upsert(
      {
        ticket_id: ticketId,
        delivery_date,
        delivery_address: delivery_address || null,
        delivery_notes: delivery_notes || null,
      },
      { onConflict: "ticket_id" }
    );

  if (upsertError) {
    console.error("Error upserting delivery details:", upsertError);
    return { error: upsertError.message, code: "conflict" };
  }

  const { error: statusError } = await supabase
    .from("tickets")
    .update({ status: "in_delivery" })
    .eq("id", ticketId);

  if (statusError) {
    console.error("Error updating ticket status to in_delivery:", statusError);
    return { error: statusError.message, code: "conflict" };
  }

  await supabase.from("ticket_history").insert({
    ticket_id: ticketId,
    user_id: user.id,
    action: "delivery_registered",
    old_value: "purchasing",
    new_value: "in_delivery",
    metadata: {
      delivery_date,
      delivery_address: delivery_address || null,
    },
  });

  revalidatePath(`/chamados/compras/${ticketId}`);
  revalidatePath("/chamados/compras");
  return { success: true };
}

/**
 * Registra avaliação da entrega e muda status para 'evaluating'
 */
export async function evaluateDelivery(ticketId: string, formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Não autenticado", code: "forbidden" };
  }

  const { data: ticket } = await supabase
    .from("tickets")
    .select("status, created_by")
    .eq("id", ticketId)
    .single();

  if (!ticket) {
    return { error: "Chamado não encontrado", code: "not_found" };
  }

  if (ticket.status !== "delivered") {
    return {
      error: "Chamado não está no status 'Entrega Realizada'",
      code: "conflict",
    };
  }

  if (user.id !== ticket.created_by) {
    return {
      error: "Apenas o solicitante pode avaliar a entrega",
      code: "forbidden",
    };
  }

  const delivery_rating_raw = formData.get("delivery_rating");
  const delivery_feedback = formData.get("delivery_feedback") as string | null;

  const delivery_rating = delivery_rating_raw
    ? parseInt(delivery_rating_raw as string)
    : null;

  if (!delivery_rating || delivery_rating < 1 || delivery_rating > 5) {
    return { error: "Avaliação deve ser entre 1 e 5 estrelas", code: "validation" };
  }

  const { data: existing } = await supabase
    .from("ticket_purchase_details")
    .select("delivery_notes, item_name, quantity")
    .eq("ticket_id", ticketId)
    .maybeSingle();

  let deliveryNotes: string | null = null;
  if (delivery_feedback) {
    const originalNotes = existing?.delivery_notes?.trim();
    deliveryNotes = originalNotes
      ? `${originalNotes}\n\n--- Avaliação do solicitante ---\n${delivery_feedback}`
      : delivery_feedback;
  }

  if (existing) {
    const updatePayload: Record<string, unknown> = {
      delivery_confirmed_at: new Date().toISOString(),
      delivery_rating,
    };
    if (deliveryNotes !== null) {
      updatePayload.delivery_notes = deliveryNotes;
    }

    const { data: updated, error: updateError } = await supabase
      .from("ticket_purchase_details")
      .update(updatePayload)
      .eq("ticket_id", ticketId)
      .select("ticket_id");

    if (updateError) {
      console.error("Error updating delivery evaluation:", updateError);
      return { error: updateError.message, code: "conflict" };
    }

    if (!updated || updated.length === 0) {
      return { error: "Falha ao salvar avaliação. Nenhum registro foi atualizado.", code: "conflict" };
    }
  } else {
    const { data: items } = await supabase
      .from("ticket_purchase_items")
      .select("item_name, quantity, unit_of_measure, estimated_price")
      .eq("ticket_id", ticketId)
      .order("sort_order", { ascending: true })
      .limit(1);

    const fallbackItem = items?.[0];

    const { data: inserted, error: insertError } = await supabase
      .from("ticket_purchase_details")
      .insert({
        ticket_id: ticketId,
        item_name: fallbackItem?.item_name ?? "Item não especificado",
        quantity: fallbackItem?.quantity ?? 1,
        unit_of_measure: fallbackItem?.unit_of_measure ?? "un",
        estimated_price: fallbackItem?.estimated_price ?? null,
        delivery_confirmed_at: new Date().toISOString(),
        delivery_rating,
        delivery_notes: deliveryNotes,
      })
      .select("ticket_id");

    if (insertError) {
      console.error("Error inserting delivery evaluation for legacy ticket:", insertError);
      return { error: insertError.message, code: "conflict" };
    }

    if (!inserted || inserted.length === 0) {
      return { error: "Falha ao salvar avaliação. Nenhum registro foi criado.", code: "conflict" };
    }
  }

  const { error: statusError } = await supabase
    .from("tickets")
    .update({ status: "evaluating" })
    .eq("id", ticketId);

  if (statusError) {
    console.error("Error updating ticket status to evaluating:", statusError);
    return { error: statusError.message, code: "conflict" };
  }

  await supabase.from("ticket_history").insert({
    ticket_id: ticketId,
    user_id: user.id,
    action: "delivery_evaluated",
    old_value: "delivered",
    new_value: "evaluating",
    metadata: { rating: delivery_rating },
  });

  revalidatePath(`/chamados/compras/${ticketId}`);
  revalidatePath("/chamados/compras");
  return { success: true };
}

/**
 * Obtém histórico do chamado
 */
export async function getTicketHistory(ticketId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ticket_history")
    .select(
      `
      *,
      user:profiles!user_id(id, full_name, avatar_url)
    `
    )
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching ticket history:", error);
    return [];
  }

  return data || [];
}

// ============================================
// Quotation Functions
// ============================================

/**
 * Adiciona cotação ao chamado
 */
export async function addQuotation(ticketId: string, formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Não autenticado" };
  }

  const supplier_name = formData.get("supplier_name") as string;
  const supplier_cnpj = formData.get("supplier_cnpj") as string | null;
  const supplier_contact = formData.get("supplier_contact") as string | null;
  const unit_price = parseFloat(formData.get("unit_price") as string);
  const quantity = parseInt(formData.get("quantity") as string);
  const total_price = unit_price * quantity;
  const payment_terms = formData.get("payment_terms") as string | null;
  const delivery_deadline = formData.get("delivery_deadline") as string | null;
  const validity_date = formData.get("validity_date") as string | null;
  const notes = formData.get("notes") as string | null;

  // Validações
  if (!supplier_name || supplier_name.length < 2) {
    return { error: "Nome do fornecedor é obrigatório", code: "validation" };
  }
  if (!unit_price || unit_price <= 0) {
    return { error: "Preço unitário deve ser maior que zero", code: "validation" };
  }
  if (!quantity || quantity <= 0) {
    return { error: "Quantidade deve ser maior que zero", code: "validation" };
  }

  const { error } = await supabase.from("ticket_quotations").insert({
    ticket_id: ticketId,
    supplier_name,
    supplier_cnpj: supplier_cnpj || null,
    supplier_contact: supplier_contact || null,
    unit_price,
    quantity,
    total_price,
    payment_terms: payment_terms || null,
    delivery_deadline: delivery_deadline || null,
    validity_date: validity_date || null,
    notes: notes || null,
    created_by: user.id,
  });

  if (error) {
    console.error("Error adding quotation:", error);
    return { error: error.message, code: "conflict" };
  }

  // Atualizar status se ainda não estiver em cotação
  await supabase
    .from("tickets")
    .update({ status: "quoting" })
    .eq("id", ticketId)
    .in("status", ["awaiting_triage", "in_progress"]);

  revalidatePath(`/chamados/compras/${ticketId}`);
  return { success: true };
}

/**
 * Seleciona cotação vencedora (não altera o status do ticket)
 */
export async function selectQuotation(ticketId: string, quotationId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Não autenticado", code: "forbidden" };
  }

  // Desmarcar outras cotações (check result to surface RLS errors)
  const { error: unselectError } = await supabase
    .from("ticket_quotations")
    .update({ is_selected: false, status: "pending" })
    .eq("ticket_id", ticketId);

  if (unselectError) {
    console.error("Error unselecting quotations:", unselectError);
    const code = unselectError.code === "42501" || unselectError.message?.includes("row-level security")
      ? "forbidden"
      : "conflict";
    return { error: unselectError.message, code };
  }

  // Marcar cotação selecionada
  const { error } = await supabase
    .from("ticket_quotations")
    .update({ is_selected: true, status: "approved" })
    .eq("id", quotationId);

  if (error) {
    console.error("Error selecting quotation:", error);
    return { error: error.message, code: "conflict" };
  }

  // Vincular aos detalhes de compra
  await supabase
    .from("ticket_purchase_details")
    .update({ approved_quotation_id: quotationId })
    .eq("ticket_id", ticketId);

  revalidatePath(`/chamados/compras/${ticketId}`);
  return { success: true };
}

/**
 * Verifica se usuário atual é interessado no ticket de compras filho
 * (Gerente do departamento do criador do chamado pai)
 */
export async function getIsInteressado(ticketId: string): Promise<boolean> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: ticket } = await supabase
    .from("tickets")
    .select("parent_ticket_id")
    .eq("id", ticketId)
    .single();

  if (!ticket?.parent_ticket_id) {
    return false;
  }

  const { data: parentTicket } = await supabase
    .from("tickets")
    .select("created_by")
    .eq("id", ticket.parent_ticket_id)
    .single();

  if (!parentTicket?.created_by) {
    return false;
  }

  const { data: creatorRoles } = await supabase
    .from("user_roles")
    .select(
      `
      role:roles!role_id(department_id)
    `
    )
    .eq("user_id", parentTicket.created_by);

  interface RoleDepartmentData {
    role:
      | {
          department_id: string | null;
        }
      | {
          department_id: string | null;
        }[]
      | null;
  }

  const creatorDepartmentIds = (
    (creatorRoles as RoleDepartmentData[] | null) ?? []
  )
    .map((ur) => {
      const role = Array.isArray(ur.role) ? ur.role[0] : ur.role;
      return role?.department_id ?? null;
    })
    .filter((departmentId): departmentId is string => Boolean(departmentId));

  if (creatorDepartmentIds.length === 0) {
    return false;
  }

  const { data: currentUserRoles } = await supabase
    .from("user_roles")
    .select(
      `
      role:roles!role_id(name, department_id)
    `
    )
    .eq("user_id", user.id);

  interface RoleNameDepartmentData {
    role:
      | {
          name: string;
          department_id: string | null;
        }
      | {
          name: string;
          department_id: string | null;
        }[]
      | null;
  }

  const isInteressado = (
    (currentUserRoles as RoleNameDepartmentData[] | null) ?? []
  ).some((ur) => {
    const role = Array.isArray(ur.role) ? ur.role[0] : ur.role;
    if (!role) return false;

    return (
      role.name === "Gerente" &&
      !!role.department_id &&
      creatorDepartmentIds.includes(role.department_id)
    );
  });

  return isInteressado;
}

/**
 * Seleciona cotação vencedora pelo interessado e aprova o chamado
 */
export async function selectQuotationByRequester(
  ticketId: string,
  quotationId: string
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Não autenticado", code: "forbidden" };
  }

  const isInteressado = await getIsInteressado(ticketId);
  if (!isInteressado) {
    return { error: "Apenas o interessado pode selecionar a cotação", code: "forbidden" };
  }

  const { data: ticket } = await supabase
    .from("tickets")
    .select("status")
    .eq("id", ticketId)
    .single();

  if (!ticket) {
    return { error: "Chamado não encontrado", code: "not_found" };
  }

  if (ticket.status !== "awaiting_requester_selection") {
    return {
      error: "Chamado não está aguardando seleção do solicitante",
      code: "conflict",
    };
  }

  const { error: unselectError } = await supabase
    .from("ticket_quotations")
    .update({ is_selected: false, status: "pending" })
    .eq("ticket_id", ticketId);

  if (unselectError) {
    console.error("Error unselecting quotations:", unselectError);
    return { error: unselectError.message, code: "conflict" };
  }

  const { error: selectError } = await supabase
    .from("ticket_quotations")
    .update({ is_selected: true, status: "approved" })
    .eq("id", quotationId)
    .eq("ticket_id", ticketId);

  if (selectError) {
    console.error("Error selecting requester quotation:", selectError);
    return { error: selectError.message, code: "conflict" };
  }

  await supabase
    .from("ticket_purchase_details")
    .update({ approved_quotation_id: quotationId })
    .eq("ticket_id", ticketId);

  const { data: updatedTickets, error: ticketUpdateError } = await supabase
    .from("tickets")
    .update({ status: "approved" })
    .eq("id", ticketId)
    .select("id");

  if (ticketUpdateError) {
    console.error("Error approving ticket after requester selection:", ticketUpdateError);
    return { error: ticketUpdateError.message, code: "conflict" };
  }

  if (!updatedTickets || updatedTickets.length === 0) {
    return {
      error:
        "Não foi possível aprovar o chamado. O chamado pode ter sido alterado por outro usuário.",
      code: "conflict",
    };
  }

  await supabase.from("ticket_history").insert({
    ticket_id: ticketId,
    user_id: user.id,
    action: "requester_selected_quotation",
    old_value: "awaiting_requester_selection",
    new_value: "approved",
  });

  revalidatePath(`/chamados/compras/${ticketId}`);
  revalidatePath("/chamados/compras");
  return { success: true };
}

/**
 * Envia chamado em cotação para aprovação.
 * Requer que o status seja 'quoting', o usuário seja membro de Compras,
 * e que exista ao menos uma cotação selecionada.
 */
export async function sendToApproval(ticketId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Não autenticado", code: "forbidden" };
  }

  const { data: ticket } = await supabase
    .from("tickets")
    .select("status")
    .eq("id", ticketId)
    .single();

  if (!ticket) {
    return { error: "Chamado não encontrado", code: "not_found" };
  }

  if (ticket.status !== "quoting") {
    return { error: "Chamado não está em cotação", code: "conflict" };
  }

  const canManage = await canManageTicket(ticketId);
  if (!canManage) {
    return { error: "Apenas membros de Compras podem enviar para aprovação", code: "forbidden" };
  }

  const { data: selectedQuotations } = await supabase
    .from("ticket_quotations")
    .select("id")
    .eq("ticket_id", ticketId)
    .eq("is_selected", true)
    .limit(1);

  if (!selectedQuotations || selectedQuotations.length === 0) {
    return { error: "Selecione uma cotação antes de enviar para aprovação", code: "validation" };
  }

  const { data: updatedTickets, error: updateError } = await supabase
    .from("tickets")
    .update({ status: "awaiting_approval" })
    .eq("id", ticketId)
    .select("id");

  if (updateError) {
    console.error("Error sending to approval:", updateError);
    return { error: updateError.message, code: "conflict" };
  }

  if (!updatedTickets || updatedTickets.length === 0) {
    return {
      error:
        "Não foi possível enviar para aprovação. O chamado pode ter sido alterado por outro usuário.",
      code: "conflict",
    };
  }

  await supabase.from("ticket_history").insert({
    ticket_id: ticketId,
    user_id: user.id,
    action: "sent_to_approval",
    old_value: "quoting",
    new_value: "awaiting_approval",
  });

  revalidatePath(`/chamados/compras/${ticketId}`);
  revalidatePath("/chamados/compras");
  return { success: true };
}

/**
 * Envia chamado em cotação para seleção do solicitante.
 * Requer entre 2 e 3 cotações e ticket filho de outro chamado.
 */
export async function sendToRequesterSelection(ticketId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Não autenticado", code: "forbidden" };
  }

  const canManage = await canManageTicket(ticketId);
  if (!canManage) {
    return { error: "Apenas membros de Compras podem enviar para seleção", code: "forbidden" };
  }

  const { data: ticket } = await supabase
    .from("tickets")
    .select("status, parent_ticket_id")
    .eq("id", ticketId)
    .single();

  if (!ticket) {
    return { error: "Chamado não encontrado", code: "not_found" };
  }

  if (ticket.status !== "quoting") {
    return { error: "Chamado não está em cotação", code: "conflict" };
  }

  if (!ticket.parent_ticket_id) {
    return { error: "Ação disponível apenas para chamados vinculados", code: "validation" };
  }

  const { count: quotationCount, error: quotationCountError } = await supabase
    .from("ticket_quotations")
    .select("id", { count: "exact", head: true })
    .eq("ticket_id", ticketId);

  if (quotationCountError) {
    console.error("Error counting quotations:", quotationCountError);
    return { error: quotationCountError.message, code: "conflict" };
  }

  const totalQuotations = quotationCount ?? 0;
  if (totalQuotations < 2 || totalQuotations > 3) {
    return { error: "É necessário ter entre 2 e 3 cotações para enviar à seleção", code: "validation" };
  }

  const { data: updatedTickets, error: updateError } = await supabase
    .from("tickets")
    .update({ status: "awaiting_requester_selection" })
    .eq("id", ticketId)
    .select("id");

  if (updateError) {
    console.error("Error sending to requester selection:", updateError);
    return { error: updateError.message, code: "conflict" };
  }

  if (!updatedTickets || updatedTickets.length === 0) {
    return {
      error:
        "Não foi possível enviar para seleção. O chamado pode ter sido alterado por outro usuário.",
      code: "conflict",
    };
  }

  await supabase.from("ticket_history").insert({
    ticket_id: ticketId,
    user_id: user.id,
    action: "sent_to_requester_selection",
    old_value: "quoting",
    new_value: "awaiting_requester_selection",
  });

  revalidatePath(`/chamados/compras/${ticketId}`);
  revalidatePath("/chamados/compras");
  return { success: true };
}

/**
 * Remove cotação
 */
export async function deleteQuotation(ticketId: string, quotationId: string) {
  const supabase = await createClient();

  const { error } = await supabase
    .from("ticket_quotations")
    .delete()
    .eq("id", quotationId)
    .eq("ticket_id", ticketId);

  if (error) {
    console.error("Error deleting quotation:", error);
    return { error: error.message, code: "conflict" };
  }

  revalidatePath(`/chamados/compras/${ticketId}`);
  return { success: true };
}

// ============================================
// Status Functions
// ============================================

/**
 * Muda status do chamado
 */
export async function changeTicketStatus(
  ticketId: string,
  newStatus: string,
  reason?: string
) {
  const supabase = await createClient();

  const { data: ticket } = await supabase
    .from("tickets")
    .select("status")
    .eq("id", ticketId)
    .single();

  if (!ticket) {
    return { error: "Chamado não encontrado", code: "not_found" };
  }

  // This transition must always go through the dedicated guarded flow
  // that enforces Compras membership, linked-ticket requirement and 2-3 quotations.
  if (newStatus === "awaiting_requester_selection") {
    return sendToRequesterSelection(ticketId);
  }

  // Verificar se é admin ou Gerente (podem fechar/cancelar de qualquer status)
  const { data: isAdmin } = await supabase.rpc("is_admin");
  const isGerente = await checkIsGerente();
  const adminOverrideStatuses = ["closed", "cancelled"];
  const finalStatuses = ["closed", "cancelled", "denied"];

  // Admin ou Gerente pode fechar/cancelar chamados que não estão em status final
  // Correção BUG-014: Gerente também deve poder fechar chamados (requisito OPR-GER-013)
  if (
    (isAdmin || isGerente) &&
    adminOverrideStatuses.includes(newStatus) &&
    !finalStatuses.includes(ticket.status)
  ) {
    // Permitir transição
  } else {
    const allowedTransitions = statusTransitions[ticket.status] || [];
    if (!allowedTransitions.includes(newStatus)) {
      return {
        error: `Transição de ${statusLabels[ticket.status]} para ${statusLabels[newStatus]} não permitida`,
        code: "validation",
      };
    }
  }

  const trimmedReason = reason?.trim();
  if (newStatus === "denied" && !trimmedReason) {
    return { error: "Informe o motivo da negação", code: "validation" };
  }

  // Validar permissão para a transição solicitada
  const requiredPermission = getTransitionPermission(newStatus);
  if (requiredPermission !== null) {
    const userPermissions = await getCurrentUserPermissions();
    if (!hasPermission(userPermissions, requiredPermission as Permission)) {
      return {
        error: `Você não tem permissão para realizar esta ação. A transição para "${statusLabels[newStatus]}" requer permissão de ${requiredPermission === "tickets:approve" ? "aprovação" : "execução"}.`,
        code: "forbidden",
      };
    }
  }

  const updates: Record<string, unknown> = { status: newStatus };

  if (newStatus === "denied" && trimmedReason) {
    updates.denial_reason = trimmedReason;
  }

  if (newStatus === "closed") {
    updates.closed_at = new Date().toISOString();
  }

  const { data: updatedTickets, error } = await supabase
    .from("tickets")
    .update(updates)
    .eq("id", ticketId)
    .select("id, status");

  if (error) {
    console.error("Error changing ticket status:", error);
    return { error: error.message, code: "conflict" };
  }

  if (!updatedTickets || updatedTickets.length === 0) {
    return {
      error:
        "Não foi possível atualizar o status. O chamado pode ter sido alterado por outro usuário.",
      code: "conflict",
    };
  }

  revalidatePath(`/chamados/compras/${ticketId}`);
  revalidatePath("/chamados/compras");
  return { success: true };
}

// ============================================
// Triage Functions
// ============================================

/**
 * Cargos que podem fazer triagem de chamados de Compras
 */
const TRIAGE_ROLES = [
  "Desenvolvedor",
  "Administrador",
  "Diretor",
  "Gerente",
  "Supervisor",
  "Coordenador",
];

/**
 * Verifica se o usuário atual pode triar chamados de Compras
 */
export async function canTriageTicket(): Promise<boolean> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  // Admin pode tudo
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin) return true;

  // Obter os departamentos de Compras (pode ter "Compras" ou "Compras e Manutenção")
  const { data: comprasDepts } = await supabase
    .from("departments")
    .select("id")
    .or("name.eq.Compras,name.eq.Compras e Manutenção");

  if (!comprasDepts || comprasDepts.length === 0) return false;

  const deptIds = comprasDepts.map((d) => d.id);

  // Verificar se usuário tem cargo de triagem no departamento de Compras
  const { data: userRoles } = await supabase
    .from("user_roles")
    .select(
      `
      role:roles!role_id(name, department_id)
    `
    )
    .eq("user_id", user.id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasTriageRole = userRoles?.some((ur: any) => {
    const role = ur.role;
    if (!role) return false;

    // Se é um cargo global de triagem (podem triar chamados de qualquer departamento)
    if (
      ["Desenvolvedor", "Administrador", "Diretor", "Gerente"].includes(
        role.name
      )
    )
      return true;

    // Se é um cargo de triagem dentro do departamento de Compras
    return (
      deptIds.includes(role.department_id) && TRIAGE_ROLES.includes(role.name)
    );
  });

  return hasTriageRole || false;
}

/**
 * Lista membros do departamento de Compras
 */
export async function getComprasDepartmentMembers() {
  const supabase = await createClient();

  // Buscar departamentos de Compras (pode ter "Compras" ou "Compras e Manutenção")
  const { data: comprasDepts } = await supabase
    .from("departments")
    .select("id")
    .or("name.eq.Compras,name.eq.Compras e Manutenção");

  if (!comprasDepts || comprasDepts.length === 0) return [];

  const deptIds = comprasDepts.map((d) => d.id);

  const { data } = await supabase.from("user_roles").select(`
      user:profiles!user_id(id, full_name, email, avatar_url),
      role:roles!role_id(name, department_id)
    `);

  // Filtrar por departamentos de Compras, removendo duplicatas
  const membersMap = new Map<
    string,
    {
      id: string;
      full_name: string;
      email: string;
      avatar_url: string | null;
      role: string;
    }
  >();

  data?.forEach((d: Record<string, unknown>) => {
    const role = d.role as { department_id: string; name: string } | null;
    const user = d.user as {
      id: string;
      full_name: string;
      email: string;
      avatar_url: string | null;
    } | null;

    if (role && user && deptIds.includes(role.department_id)) {
      // Se já existe, não sobrescreve (mantém o primeiro cargo encontrado)
      if (!membersMap.has(user.id)) {
        membersMap.set(user.id, {
          ...user,
          role: role.name,
        });
      }
    }
  });

  return Array.from(membersMap.values());
}

/**
 * Triar chamado
 *
 * Apenas Supervisores, Gerentes ou Coordenadores do departamento de Compras
 * (ou admins globais) podem triar chamados.
 */
export async function triageTicket(ticketId: string, formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Não autenticado", code: "forbidden" };
  }

  // Verificar permissão de triagem
  const canTriage = await canTriageTicket();
  if (!canTriage) {
    return { error: "Você não tem permissão para fazer triagem de chamados", code: "forbidden" };
  }

  // Verificar se o chamado existe e está aguardando triagem
  const { data: ticket } = await supabase
    .from("tickets")
    .select("status, priority, assigned_to")
    .eq("id", ticketId)
    .single();

  if (!ticket) {
    return { error: "Chamado não encontrado", code: "not_found" };
  }

  if (ticket.status !== "awaiting_triage") {
    return { error: "Este chamado não está aguardando triagem", code: "conflict" };
  }

  const priority = formData.get("priority") as string;
  const assigned_to = formData.get("assigned_to") as string;
  const due_date = formData.get("due_date") as string | null;

  // Validações
  if (!priority) {
    return { error: "Prioridade é obrigatória", code: "validation" };
  }
  if (!assigned_to) {
    return { error: "Responsável é obrigatório", code: "validation" };
  }

  // Validar se a prioridade é válida
  const validPriorities = ["low", "medium", "high", "urgent"];
  if (!validPriorities.includes(priority)) {
    return { error: "Prioridade inválida", code: "validation" };
  }

  // Atualizar o chamado
  const { error: updateError } = await supabase
    .from("tickets")
    .update({
      priority,
      assigned_to,
      due_date: due_date || null,
      status: "in_progress",
    })
    .eq("id", ticketId);

  if (updateError) {
    console.error("Error triaging ticket:", updateError);
    return { error: updateError.message, code: "conflict" };
  }

  // Registrar histórico de triagem manualmente (além do trigger automático)
  // para incluir metadados adicionais sobre a triagem
  await supabase.from("ticket_history").insert({
    ticket_id: ticketId,
    user_id: user.id,
    action: "triaged",
    old_value: "awaiting_triage",
    new_value: "in_progress",
    metadata: {
      priority,
      assigned_to,
      due_date: due_date || null,
      triaged_by: user.id,
    },
  });

  revalidatePath(`/chamados/compras/${ticketId}`);
  revalidatePath("/chamados/compras");
  return { success: true };
}

// ============================================
// Comment Functions
// ============================================

/**
 * Adiciona comentário ao chamado
 */
export async function addComment(ticketId: string, formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Não autenticado", code: "forbidden" };
  }

  const content = formData.get("content") as string;
  const is_internal = formData.get("is_internal") === "true";

  if (!content || content.trim().length < 1) {
    return { error: "Comentário não pode ser vazio", code: "validation" };
  }

  const { error } = await supabase.from("ticket_comments").insert({
    ticket_id: ticketId,
    user_id: user.id,
    content: content.trim(),
    is_internal,
  });

  if (error) {
    console.error("Error adding comment:", error);
    return { error: error.message, code: "conflict" };
  }

  revalidatePath(`/chamados/compras/${ticketId}`);
  return { success: true };
}

// ============================================
// Approval Functions
// ============================================

/**
 * Aprovar/Rejeitar chamado
 */
export async function handleApproval(
  ticketId: string,
  approvalId: string,
  decision: ApprovalDecision,
  notes?: string
) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Não autenticado", code: "forbidden" };
  }

  const { data: approval } = await supabase
    .from("ticket_approvals")
    .select("approval_level, approval_role")
    .eq("id", approvalId)
    .single();

  if (!approval) {
    return { error: "Aprovação não encontrada", code: "not_found" };
  }

  const opsCheck = await ensureOperacoesGerenteApproval(
    supabase,
    ticketId,
    approval.approval_level,
    approval.approval_role
  );
  if (opsCheck?.error) {
    return { ...opsCheck, code: "forbidden" as const };
  }

  const comprasCheck = await ensureComprasPurchaseApproval(
    supabase,
    ticketId,
    approval.approval_role
  );
  if (comprasCheck?.error) {
    return { ...comprasCheck, code: "forbidden" as const };
  }

  // Atualizar aprovação
  const { data: approvalUpdate, error } = await supabase
    .from("ticket_approvals")
    .update({
      approved_by: user.id,
      status: decision,
      decision_at: new Date().toISOString(),
      notes: notes || null,
    })
    .eq("id", approvalId)
    .select();

  if (error) {
    console.error("Error handling approval:", error);
    return { error: error.message, code: "conflict" };
  }

  // Verify the update actually affected a row (RLS may silently block)
  if (!approvalUpdate || approvalUpdate.length === 0) {
    console.error("Approval update affected 0 rows - RLS may have blocked");
    return {
      error: "Não foi possível processar a aprovação. Verifique suas permissões.",
      code: "conflict",
    };
  }

  // Atualizar status do ticket
  if (decision === APPROVAL_FLOW_STATUS.denied) {
    const { data: ticketUpdate, error: ticketError } = await supabase
      .from("tickets")
      .update({
        status: APPROVAL_FLOW_STATUS.denied,
        denial_reason: notes || "Negado na aprovação",
      })
      .eq("id", ticketId)
      .select();

    if (ticketError) {
      console.error("Error updating ticket status (denied):", ticketError);
      return {
        error: "Aprovação registrada, mas falha ao atualizar status do chamado",
        code: "conflict",
      };
    }

    // Verify the update actually affected a row
    if (!ticketUpdate || ticketUpdate.length === 0) {
      console.error("Ticket update (denied) affected 0 rows - RLS may have blocked");
      return {
        error: "Não foi possível processar a aprovação. Verifique suas permissões.",
        code: "conflict",
      };
    }
  } else {
    // Aprovar e avançar para próximo nível ou triagem
    // Usar approval_role ao invés de approval_level para determinar próximo status
    const nextStatusByRole: Record<string, ApprovalFlowStatus> = {
      Encarregado: APPROVAL_FLOW_STATUS.awaitingApprovalSupervisor,
      Supervisor: APPROVAL_FLOW_STATUS.awaitingApprovalGerente,
      Gerente: APPROVAL_FLOW_STATUS.awaitingTriage,
    };

    const nextStatus = nextStatusByRole[approval.approval_role];
    if (!nextStatus) {
      console.error("Unknown approval role:", approval.approval_role);
      return { error: "Cargo de aprovação desconhecido", code: "validation" };
    }

    const { data: ticketUpdate, error: ticketError } = await supabase
      .from("tickets")
      .update({ status: nextStatus })
      .eq("id", ticketId)
      .select();

    if (ticketError) {
      console.error("Error updating ticket status (approved):", ticketError);
      return {
        error: "Aprovação registrada, mas falha ao atualizar status do chamado",
        code: "conflict",
      };
    }

    // Verify the update actually affected a row
    if (!ticketUpdate || ticketUpdate.length === 0) {
      console.error("Ticket update (approved) affected 0 rows - RLS may have blocked");
      return {
        error: "Não foi possível processar a aprovação. Verifique suas permissões.",
        code: "conflict",
      };
    }
  }

  revalidatePath(`/chamados/compras/${ticketId}`);
  revalidatePath("/chamados/compras");
  return { success: true };
}

/**
 * Lista aprovações pendentes para o usuário
 */
export async function getPendingApprovals() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  // Verificar cargo do usuário
  const { data: userRoles } = await supabase
    .from("user_roles")
    .select(
      `
      role:roles!role_id(name)
    `
    )
    .eq("user_id", user.id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roles = userRoles?.map((r: any) => r.role?.name).filter(Boolean) || [];

  let approvalLevel: number | null = null;
  if (roles.includes("Encarregado")) approvalLevel = 1;
  else if (roles.includes("Supervisor")) approvalLevel = 2;
  else if (roles.includes("Gerente")) approvalLevel = 3;

  if (!approvalLevel) return [];

  const { data } = await supabase
    .from("ticket_approvals")
    .select(
      `
      *,
      ticket:tickets(
        id,
        ticket_number,
        title,
        created_by,
        created_at,
        creator:profiles!created_by(full_name)
      )
    `
    )
    .eq("approval_level", approvalLevel)
    .eq("status", "pending");

  return data || [];
}

/**
 * Verificar se usuário pode gerenciar o chamado
 */
export async function canManageTicket(_ticketId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  // Admin pode tudo
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin) return true;

  // Verificar se é do departamento de Compras
  const comprasDept = await getComprasDepartment();
  if (!comprasDept) return false;

  const { data: userRoles } = await supabase
    .from("user_roles")
    .select(
      `
      role:roles!role_id(department_id, name)
    `
    )
    .eq("user_id", user.id);

  interface RoleDeptQueryData {
    role:
      | {
          department_id: string | null;
          name: string;
        }
      | {
          department_id: string | null;
          name: string;
        }[]
      | null;
  }

  const isComprasMember = (
    userRoles as RoleDeptQueryData[] | null
  )?.some((ur) => {
    const role = Array.isArray(ur.role) ? ur.role[0] : ur.role;
    return role?.department_id === comprasDept.id;
  });

  return isComprasMember || false;
}
