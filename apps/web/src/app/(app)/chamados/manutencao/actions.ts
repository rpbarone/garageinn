"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import type { ApprovalDecision, ApprovalFlowStatus } from "@/lib/ticket-statuses";
import { APPROVAL_FLOW_STATUS } from "@/lib/ticket-statuses";

// ============================================
// Types
// ============================================

export interface TicketFilters {
  status?: string;
  priority?: string;
  category_id?: string;
  unit_id?: string;
  assigned_to?: string;
  maintenance_type?: string;
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

export interface MaintenanceCategory {
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

/**
 * Obtém unidades acessíveis ao usuário atual
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
 */
export async function getUserFixedUnit(): Promise<UserUnit | null> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Verificar se tem role de unidade fixa
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

// ============================================
// Query Functions
// ============================================

/**
 * Busca departamento de Manutenção
 */
async function getManutencaoDepartment() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("departments")
    .select("id")
    .eq("name", "Compras e Manutenção")
    .single();

  if (error) {
    console.error("Error fetching Manutenção department:", error);
    return null;
  }

  return data;
}

/**
 * Lista categorias/assuntos de Manutenção
 */
export async function getMaintenanceCategories(): Promise<
  MaintenanceCategory[]
> {
  const supabase = await createClient();

  const manutencaoDept = await getManutencaoDepartment();
  if (!manutencaoDept) return [];

  const { data, error } = await supabase
    .from("ticket_categories")
    .select("*")
    .eq("department_id", manutencaoDept.id)
    .eq("status", "active")
    .order("name");

  if (error) {
    console.error("Error fetching maintenance categories:", error);
    return [];
  }

  return data || [];
}

/**
 * Lista chamados de Manutenção com filtros
 */
export async function getMaintenanceTickets(filters?: TicketFilters) {
  const supabase = await createClient();

  const page = filters?.page || 1;
  const limit = filters?.limit || 20;
  const offset = (page - 1) * limit;

  // Use the maintenance-specific view that includes maintenance details
  let query = supabase
    .from("tickets_maintenance_with_details")
    .select("*", { count: "exact" })
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

  if (filters?.maintenance_type && filters.maintenance_type !== "all") {
    query = query.eq("maintenance_type", filters.maintenance_type);
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

  const { data, error, count } = await query;

  if (error) {
    console.error("Error fetching maintenance tickets:", error);
    return { data: [], count: 0, page, limit };
  }

  return { data: data || [], count: count || 0, page, limit };
}

/**
 * Estatísticas de Chamados de Manutenção
 */
export async function getMaintenanceStats(): Promise<TicketStats> {
  const supabase = await createClient();

  const manutencaoDept = await getManutencaoDepartment();
  if (!manutencaoDept) {
    return { total: 0, awaitingTriage: 0, inProgress: 0, closed: 0 };
  }

  const { data } = await supabase
    .from("tickets")
    .select("status")
    .eq("department_id", manutencaoDept.id);

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
 * Busca um chamado de Manutenção por ID
 */
export async function getMaintenanceTicketById(ticketId: string) {
  const supabase = await createClient();

  // Use the maintenance-specific view that includes maintenance details
  const { data, error } = await supabase
    .from("tickets_maintenance_with_details")
    .select("*")
    .eq("id", ticketId)
    .single();

  if (error) {
    console.error("Error fetching maintenance ticket:", error);
    return null;
  }

  return data;
}

// ============================================
// Mutation Functions
// ============================================

/**
 * Cria um chamado de Manutenção
 */
export async function createMaintenanceTicket(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Não autenticado", code: "forbidden" };
  }

  // Obter departamento de Manutenção
  const manutencaoDept = await getManutencaoDepartment();
  if (!manutencaoDept) {
    return { error: "Departamento de Manutenção não encontrado", code: "not_found" };
  }

  // Extrair dados do formulário
  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const category_id = formData.get("category_id") as string | null;
  const unit_id = formData.get("unit_id") as string | null;
  const perceived_urgency = formData.get("perceived_urgency") as string | null;
  const maintenance_type = formData.get("maintenance_type") as string | null;
  const location_description = formData.get("location_description") as
    | string
    | null;
  const equipment_affected = formData.get("equipment_affected") as
    | string
    | null;

  // Validações
  if (!title || title.length < 5) {
    return { error: "Título deve ter pelo menos 5 caracteres", code: "validation" };
  }
  if (!description || description.length < 10) {
    return { error: "Descrição deve ter pelo menos 10 caracteres", code: "validation" };
  }
  if (!category_id) {
    return { error: "Selecione um assunto para a manutenção", code: "validation" };
  }

  // Verificar se precisa de aprovação e obter status inicial baseado no cargo
  const { data: needsApproval } = await supabase.rpc("ticket_needs_approval", {
    p_created_by: user.id,
    p_department_id: manutencaoDept.id,
  });

  // Usar função SQL que determina o status inicial correto baseado na hierarquia
  const { data: initialStatusData } = await supabase.rpc(
    "get_initial_approval_status",
    { p_created_by: user.id }
  );
  const initialStatus = initialStatusData || "awaiting_triage";

  // Criar ticket
  const { data: ticket, error: ticketError } = await supabase
    .from("tickets")
    .insert({
      title,
      description,
      department_id: manutencaoDept.id,
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
    console.error("Error creating maintenance ticket:", ticketError);
    return { error: ticketError.message, code: "conflict" };
  }

  // Criar detalhes de manutenção
  const { error: detailsError } = await supabase
    .from("ticket_maintenance_details")
    .insert({
      ticket_id: ticket.id,
      subject_id: category_id && category_id !== "" ? category_id : null,
      maintenance_type: maintenance_type || "corretiva",
      location_description: location_description || null,
      equipment_affected: equipment_affected || null,
    });

  if (detailsError) {
    console.error("Error creating maintenance details:", detailsError);
    // Rollback: deletar ticket
    await supabase.from("tickets").delete().eq("id", ticket.id);
    return { error: detailsError.message, code: "conflict" };
  }

  // Se precisa aprovação, criar registros de aprovação
  if (needsApproval) {
    await supabase.rpc("create_ticket_approvals", { p_ticket_id: ticket.id });
  }

  revalidatePath("/chamados/manutencao");
  redirect(`/chamados/manutencao/${ticket.id}`);
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
 * Busca detalhes completos do chamado de manutenção
 */
export async function getTicketDetails(ticketId: string) {
  const supabase = await createClient();

  // Buscar ticket com detalhes via view
  const { data: ticket, error: ticketError } = await supabase
    .from("tickets_maintenance_with_details")
    .select("*")
    .eq("id", ticketId)
    .single();

  if (ticketError || !ticket) {
    console.error("Error fetching ticket details:", ticketError);
    return null;
  }

  // Buscar execuções de manutenção
  const { data: executions } = await supabase
    .from("ticket_maintenance_executions")
    .select(
      `
      *,
      assigned_user:profiles!assigned_to(id, full_name, avatar_url),
      creator:profiles!created_by(id, full_name, avatar_url),
      unit:units(id, name, code)
    `
    )
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false });

  // Buscar aprovações
  const { data: approvals } = await supabase
    .from("ticket_approvals")
    .select(
      `
      *,
      approver:profiles!approved_by(id, full_name, avatar_url)
    `
    )
    .eq("ticket_id", ticketId)
    .order("approval_level", { ascending: true });

  // Buscar comentários
  const { data: comments } = await supabase
    .from("ticket_comments")
    .select(
      `
      *,
      author:profiles!user_id(id, full_name, avatar_url)
    `
    )
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  // Buscar histórico
  const { data: history } = await supabase
    .from("ticket_history")
    .select(
      `
      *,
      user:profiles!user_id(id, full_name, avatar_url)
    `
    )
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false });

  // Buscar anexos
  const { data: attachments } = await supabase
    .from("ticket_attachments")
    .select(
      `
      *,
      uploader:profiles!uploaded_by(id, full_name, avatar_url)
    `
    )
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false });

  // Buscar detalhes específicos de manutenção
  const { data: maintenanceDetails } = await supabase
    .from("ticket_maintenance_details")
    .select("*")
    .eq("ticket_id", ticketId)
    .single();

  return {
    ...ticket,
    maintenanceDetails: maintenanceDetails || null,
    executions: executions || [],
    approvals: approvals || [],
    comments: comments || [],
    history: history || [],
    attachments: attachments || [],
  };
}

// ============================================
// Triage Functions
// ============================================

/**
 * Cargos que podem fazer triagem de chamados de Manutenção
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
 * Verifica se o usuário atual pode triar chamados de Manutenção
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

  // Obter departamento de Manutenção
  const manutencaoDept = await getManutencaoDepartment();
  if (!manutencaoDept) return false;

  // Verificar se usuário tem cargo de triagem no departamento de Manutenção
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

    // Se é um cargo de triagem dentro do departamento de Manutenção
    return (
      role.department_id === manutencaoDept.id &&
      TRIAGE_ROLES.includes(role.name)
    );
  });

  return hasTriageRole || false;
}

/**
 * Lista membros do departamento de Manutenção
 */
export async function getManutencaoDepartmentMembers() {
  const supabase = await createClient();

  // Buscar departamento de Manutenção
  const manutencaoDept = await getManutencaoDepartment();
  if (!manutencaoDept) return [];

  const { data } = await supabase.from("user_roles").select(`
      user:profiles!user_id(id, full_name, email, avatar_url),
      role:roles!role_id(name, department_id)
    `);

  // Filtrar por departamento de Manutenção, removendo duplicatas
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

    if (role && user && role.department_id === manutencaoDept.id) {
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
 * Triar chamado de Manutenção
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

  // Registrar histórico de triagem
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

  revalidatePath(`/chamados/manutencao/${ticketId}`);
  revalidatePath("/chamados/manutencao");
  return { success: true };
}

// ============================================
// Status Functions
// ============================================

import {
  statusTransitions,
  statusLabels,
  getTransitionPermission,
} from "./constants";
import { hasPermission } from "@/lib/auth/rbac";
import type { Permission } from "@/lib/auth/permissions";

/**
 * Muda status do chamado de Manutenção
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

  if (newStatus === "completed") {
    updates.resolved_at = new Date().toISOString();
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

  revalidatePath(`/chamados/manutencao/${ticketId}`);
  revalidatePath("/chamados/manutencao");
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

  revalidatePath(`/chamados/manutencao/${ticketId}`);
  return { success: true };
}

// ============================================
// Approval Functions
// ============================================

/**
 * Aprovar/Rejeitar chamado de Manutenção
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

  if (!approvalUpdate || approvalUpdate.length === 0) {
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

    if (!ticketUpdate || ticketUpdate.length === 0) {
      return {
        error: "Não foi possível processar a aprovação. Verifique suas permissões.",
        code: "conflict",
      };
    }
  } else {
    // Aprovar e avançar para próximo nível ou triagem
    const nextStatusMap: Record<number, ApprovalFlowStatus> = {
      1: APPROVAL_FLOW_STATUS.awaitingApprovalSupervisor,
      2: APPROVAL_FLOW_STATUS.awaitingApprovalGerente,
      3: APPROVAL_FLOW_STATUS.awaitingTriage,
    };

    const { data: ticketUpdate, error: ticketError } = await supabase
      .from("tickets")
      .update({ status: nextStatusMap[approval.approval_level] })
      .eq("id", ticketId)
      .select();

    if (ticketError) {
      console.error("Error updating ticket status (approved):", ticketError);
      return {
        error: "Aprovação registrada, mas falha ao atualizar status do chamado",
        code: "conflict",
      };
    }

    if (!ticketUpdate || ticketUpdate.length === 0) {
      return {
        error: "Não foi possível processar a aprovação. Verifique suas permissões.",
        code: "conflict",
      };
    }
  }

  revalidatePath(`/chamados/manutencao/${ticketId}`);
  revalidatePath("/chamados/manutencao");
  return { success: true };
}

// ============================================
// Execution Functions
// ============================================

/**
 * Adiciona uma execução de manutenção
 */
export async function addExecution(ticketId: string, formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Não autenticado", code: "forbidden" };
  }

  const unit_id = formData.get("unit_id") as string | null;
  const assigned_to = formData.get("assigned_to") as string | null;
  const description = formData.get("description") as string;
  const materials_needed = formData.get("materials_needed") as string | null;
  const start_date = formData.get("start_date") as string | null;
  const estimated_end_date = formData.get("estimated_end_date") as
    | string
    | null;
  const estimated_cost = formData.get("estimated_cost")
    ? parseFloat(formData.get("estimated_cost") as string)
    : null;
  const supplier_name = formData.get("supplier_name") as string | null;
  const supplier_contact = formData.get("supplier_contact") as string | null;
  const notes = formData.get("notes") as string | null;

  // Validações
  if (!description || description.trim().length < 5) {
    return { error: "Descrição deve ter pelo menos 5 caracteres", code: "validation" };
  }

  const { error } = await supabase
    .from("ticket_maintenance_executions")
    .insert({
      ticket_id: ticketId,
      unit_id: unit_id && unit_id !== "" ? unit_id : null,
      assigned_to: assigned_to && assigned_to !== "" ? assigned_to : null,
      description: description.trim(),
      materials_needed: materials_needed || null,
      start_date: start_date || null,
      estimated_end_date: estimated_end_date || null,
      estimated_cost,
      supplier_name: supplier_name || null,
      supplier_contact: supplier_contact || null,
      notes: notes || null,
      status: "pending",
      created_by: user.id,
    });

  if (error) {
    console.error("Error adding execution:", error);
    return { error: error.message, code: "conflict" };
  }

  // Atualizar status do ticket para "executando" se ainda não estiver
  await supabase
    .from("tickets")
    .update({ status: "executing" })
    .eq("id", ticketId)
    .in("status", [
      "awaiting_triage",
      "in_progress",
      "technical_analysis",
      "approved",
    ]);

  revalidatePath(`/chamados/manutencao/${ticketId}`);
  return { success: true };
}

/**
 * Atualiza uma execução de manutenção
 */
export async function updateExecution(executionId: string, formData: FormData) {
  const supabase = await createClient();

  const status = formData.get("status") as string;
  const actual_end_date = formData.get("actual_end_date") as string | null;
  const actual_cost = formData.get("actual_cost")
    ? parseFloat(formData.get("actual_cost") as string)
    : null;
  const notes = formData.get("notes") as string | null;

  const { error, data } = await supabase
    .from("ticket_maintenance_executions")
    .update({
      status,
      actual_end_date: actual_end_date || null,
      actual_cost,
      notes: notes || null,
    })
    .eq("id", executionId)
    .select("ticket_id")
    .single();

  if (error) {
    console.error("Error updating execution:", error);
    return { error: error.message, code: "conflict" };
  }

  // Se execução concluída, verificar se todas as execuções foram concluídas
  if (status === "completed" && data) {
    // Contar execuções não concluídas
    const { count } = await supabase
      .from("ticket_maintenance_executions")
      .select("*", { count: "exact", head: true })
      .eq("ticket_id", data.ticket_id)
      .neq("status", "completed")
      .neq("status", "cancelled");

    // Se não houver execuções pendentes, marcar ticket como concluído
    if (count === 0) {
      await supabase
        .from("tickets")
        .update({
          status: "completed",
          resolved_at: new Date().toISOString(),
        })
        .eq("id", data.ticket_id);
    }
  }

  if (data) {
    revalidatePath(`/chamados/manutencao/${data.ticket_id}`);
  }
  return { success: true };
}

/**
 * Marcar execução como aguardando peças/materiais
 */
export async function setWaitingParts(ticketId: string, executionId: string) {
  const supabase = await createClient();

  // Atualizar execução
  const { error: execError } = await supabase
    .from("ticket_maintenance_executions")
    .update({ status: "waiting_parts" })
    .eq("id", executionId);

  if (execError) {
    console.error("Error updating execution:", execError);
    return { error: execError.message, code: "conflict" };
  }

  // Atualizar ticket
  const { error: ticketError } = await supabase
    .from("tickets")
    .update({ status: "waiting_parts" })
    .eq("id", ticketId);

  if (ticketError) {
    console.error("Error updating ticket:", ticketError);
    return { error: ticketError.message, code: "conflict" };
  }

  revalidatePath(`/chamados/manutencao/${ticketId}`);
  return { success: true };
}

/**
 * Iniciar execução de manutenção
 */
export async function startExecution(executionId: string) {
  const supabase = await createClient();

  const { error, data } = await supabase
    .from("ticket_maintenance_executions")
    .update({
      status: "in_progress",
      start_date: new Date().toISOString().split("T")[0],
    })
    .eq("id", executionId)
    .select("ticket_id")
    .single();

  if (error) {
    console.error("Error starting execution:", error);
    return { error: error.message, code: "conflict" };
  }

  // Garantir que o ticket esteja em "executando"
  if (data) {
    await supabase
      .from("tickets")
      .update({ status: "executing" })
      .eq("id", data.ticket_id)
      .neq("status", "executing");

    revalidatePath(`/chamados/manutencao/${data.ticket_id}`);
  }

  return { success: true };
}

/**
 * Concluir execução de manutenção
 */
export async function completeExecution(
  executionId: string,
  formData: FormData
) {
  const supabase = await createClient();

  const actual_cost = formData.get("actual_cost")
    ? parseFloat(formData.get("actual_cost") as string)
    : null;
  const notes = formData.get("notes") as string | null;

  const { error, data } = await supabase
    .from("ticket_maintenance_executions")
    .update({
      status: "completed",
      actual_end_date: new Date().toISOString().split("T")[0],
      actual_cost,
      notes: notes || null,
    })
    .eq("id", executionId)
    .select("ticket_id")
    .single();

  if (error) {
    console.error("Error completing execution:", error);
    return { error: error.message, code: "conflict" };
  }

  // Verificar se todas as execuções foram concluídas
  if (data) {
    const { count } = await supabase
      .from("ticket_maintenance_executions")
      .select("*", { count: "exact", head: true })
      .eq("ticket_id", data.ticket_id)
      .neq("status", "completed")
      .neq("status", "cancelled");

    if (count === 0) {
      await supabase
        .from("tickets")
        .update({
          status: "completed",
          resolved_at: new Date().toISOString(),
        })
        .eq("id", data.ticket_id);
    }

    revalidatePath(`/chamados/manutencao/${data.ticket_id}`);
  }

  return { success: true };
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

  // Verificar se é do departamento de Manutenção
  const manutencaoDept = await getManutencaoDepartment();
  if (!manutencaoDept) return false;

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

  const isManutencaoMember = (
    userRoles as RoleDeptQueryData[] | null
  )?.some((ur) => {
    const role = Array.isArray(ur.role) ? ur.role[0] : ur.role;
    return role?.department_id === manutencaoDept.id;
  });

  return isManutencaoMember || false;
}

// ============================================
// Linked Ticket Functions
// ============================================

/**
 * Busca chamados vinculados a um chamado pai
 */
export async function getLinkedTickets(parentTicketId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tickets")
    .select(
      `
      id,
      ticket_number,
      title,
      status,
      created_at,
      department_id,
      departments:department_id(name)
    `
    )
    .eq("parent_ticket_id", parentTicketId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching linked tickets:", error);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data || []).map((t: any) => ({
    id: t.id,
    ticket_number: t.ticket_number,
    title: t.title,
    status: t.status,
    created_at: t.created_at,
    department_name: t.departments?.name ?? "",
  }));
}

/**
 * Busca categorias do departamento de Compras para chamados vinculados
 */
export async function getComprasCategoriesForLinkedTicket() {
  const supabase = await createClient();

  const { data: dept } = await supabase
    .from("departments")
    .select("id")
    .eq("name", "Compras e Manutenção")
    .single();

  if (!dept) return [];

  const { data, error } = await supabase
    .from("ticket_categories")
    .select("id, name")
    .eq("department_id", dept.id)
    .eq("status", "active")
    .order("name");

  if (error) {
    console.error("Error fetching compras categories:", error);
    return [];
  }

  return data || [];
}

/**
 * Busca categorias do departamento de TI para chamados vinculados
 */
export async function getTiCategoriesForLinkedTicket() {
  const supabase = await createClient();

  const { data: dept } = await supabase
    .from("departments")
    .select("id")
    .eq("name", "TI")
    .single();

  if (!dept) return [];

  const { data, error } = await supabase
    .from("ticket_categories")
    .select("id, name")
    .eq("department_id", dept.id)
    .eq("status", "active")
    .order("name");

  if (error) {
    console.error("Error fetching TI categories:", error);
    return [];
  }

  return data || [];
}

/**
 * Avaliar execução do chamado (pelo solicitante)
 */
export async function evaluateTicket(ticketId: string, formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Não autenticado", code: "forbidden" };
  }

  const rating = parseInt(formData.get("rating") as string);
  const notes = formData.get("notes") as string | null;

  if (!rating || rating < 1 || rating > 5) {
    return { error: "Avaliação deve ser entre 1 e 5", code: "validation" };
  }

  // Atualizar detalhes de manutenção com avaliação
  const { error: detailsError } = await supabase
    .from("ticket_maintenance_details")
    .update({
      completion_rating: rating,
      completion_notes: notes || null,
    })
    .eq("ticket_id", ticketId);

  if (detailsError) {
    console.error("Error evaluating ticket:", detailsError);
    return { error: detailsError.message, code: "conflict" };
  }

  // Mudar status para fechado
  const { error: ticketError } = await supabase
    .from("tickets")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
    })
    .eq("id", ticketId);

  if (ticketError) {
    console.error("Error closing ticket:", ticketError);
    return { error: ticketError.message, code: "conflict" };
  }

  revalidatePath(`/chamados/manutencao/${ticketId}`);
  revalidatePath("/chamados/manutencao");
  return { success: true };
}

// ============================================
// Create Linked Ticket
// ============================================

/**
 * Cria um chamado vinculado (Compras ou TI) a partir de um chamado de Manutenção
 */
export async function createLinkedTicket(
  parentTicketId: string,
  type: "compras" | "ti",
  formData: FormData
): Promise<ActionResult & { ticketId?: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Não autenticado", code: "forbidden" };
  }

  // Verificar se o chamado pai existe
  const { data: parentTicket } = await supabase
    .from("tickets")
    .select("id, status, department_id, unit_id")
    .eq("id", parentTicketId)
    .single();

  if (!parentTicket) {
    return { error: "Chamado pai não encontrado", code: "not_found" };
  }

  const manutencaoDept = await getManutencaoDepartment();
  if (!manutencaoDept) {
    return { error: "Departamento de Manutenção não encontrado", code: "not_found" };
  }
  if (parentTicket.department_id !== manutencaoDept.id) {
    return { error: "Chamado pai não pertence ao departamento de Manutenção", code: "validation" };
  }

  if (
    parentTicket.status !== "executing" &&
    parentTicket.status !== "waiting_parts"
  ) {
    return { error: "Chamado pai não está em execução", code: "conflict" };
  }

  const canManage = await canManageTicket(parentTicketId);
  if (!canManage) {
    return { error: "Sem permissão", code: "forbidden" };
  }

  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const category_id = formData.get("category_id") as string | null;
  const perceived_urgency = formData.get("perceived_urgency") as string | null;

  if (!title || title.length < 5) {
    return { error: "Título deve ter pelo menos 5 caracteres", code: "validation" };
  }
  if (!description || description.length < 10) {
    return { error: "Descrição deve ter pelo menos 10 caracteres", code: "validation" };
  }

  const deptName = type === "compras" ? "Compras e Manutenção" : "TI";
  const { data: targetDept } = await supabase
    .from("departments")
    .select("id")
    .eq("name", deptName)
    .single();

  if (!targetDept) {
    return { error: `Departamento ${deptName} não encontrado`, code: "not_found" };
  }

  const { data: initialStatusData } = await supabase.rpc(
    "get_initial_approval_status",
    { p_created_by: user.id }
  );
  const initialStatus = initialStatusData || "awaiting_triage";

  const { data: needsApproval } = await supabase.rpc("ticket_needs_approval", {
    p_created_by: user.id,
    p_department_id: targetDept.id,
  });

  const { data: ticket, error: ticketError } = await supabase
    .from("tickets")
    .insert({
      title,
      description,
      department_id: targetDept.id,
      category_id: category_id && category_id !== "" ? category_id : null,
      unit_id: parentTicket.unit_id ?? null,
      created_by: user.id,
      status: initialStatus,
      perceived_urgency:
        perceived_urgency && perceived_urgency !== ""
          ? perceived_urgency
          : null,
      parent_ticket_id: parentTicketId,
      origin_ticket_type: "manutencao",
    })
    .select()
    .single();

  if (ticketError) {
    console.error("Error creating linked ticket:", ticketError);
    return { error: ticketError.message, code: "conflict" };
  }

  if (type === "compras") {
    const item_name = formData.get("item_name") as string;
    const quantity = parseFloat(formData.get("quantity") as string) || 1;
    const unit_of_measure =
      (formData.get("unit_of_measure") as string) || "un";
    const estimated_price =
      parseFloat(formData.get("estimated_price") as string) || 0;

    const { error: detailsError } = await supabase
      .from("ticket_purchase_details")
      .insert({
        ticket_id: ticket.id,
        item_name: item_name || title,
        quantity,
        unit_of_measure,
        estimated_price: estimated_price || null,
      });

    if (detailsError) {
      console.error("Error creating purchase details:", detailsError);
      await supabase.from("tickets").delete().eq("id", ticket.id);
      return { error: detailsError.message, code: "conflict" };
    }

    const { error: itemsError } = await supabase
      .from("ticket_purchase_items")
      .insert({
        ticket_id: ticket.id,
        item_name: item_name || title,
        quantity,
        unit_of_measure,
        estimated_price: estimated_price || null,
        sort_order: 0,
      });

    if (itemsError) {
      console.error("Error creating purchase items:", itemsError);
      await supabase.from("tickets").delete().eq("id", ticket.id);
      return { error: itemsError.message, code: "conflict" };
    }
  } else {
    const equipment_type = (formData.get("equipment_type") as string) || "";

    const { error: detailsError } = await supabase
      .from("ticket_it_details")
      .insert({
        ticket_id: ticket.id,
        equipment_type: equipment_type.trim() || "Geral",
      });

    if (detailsError) {
      console.error("Error creating IT details:", detailsError);
      await supabase.from("tickets").delete().eq("id", ticket.id);
      return { error: detailsError.message, code: "conflict" };
    }
  }

  if (needsApproval) {
    await supabase.rpc("create_ticket_approvals", { p_ticket_id: ticket.id });
  }

  // Processar anexos
  const attachments = formData.getAll("attachments") as File[];
  const validAttachments = attachments.filter(
    (file) => file instanceof File && file.size > 0
  );
  if (validAttachments.length > 0) {
    const uploadResults = await Promise.all(
      validAttachments.map(async (file) => {
        const extension = file.name.split(".").pop() || "bin";
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        const filePath = `tickets/${ticket.id}/${Date.now()}-${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from("ticket-attachments")
          .upload(filePath, file, {
            upsert: false,
            cacheControl: "3600",
          });

        if (uploadError) {
          console.error("Error uploading attachment:", uploadError);
          return null;
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from("ticket-attachments").getPublicUrl(filePath);

        return {
          ticket_id: ticket.id,
          file_name: file.name,
          file_path: publicUrl,
          file_type: file.type || `application/${extension}`,
          file_size: file.size,
          uploaded_by: user.id,
        };
      })
    );

    const attachmentsToInsert = uploadResults.filter(
      (item): item is NonNullable<typeof item> => item !== null
    );

    if (attachmentsToInsert.length > 0) {
      const { error: attachmentError } = await supabase
        .from("ticket_attachments")
        .insert(attachmentsToInsert);

      if (attachmentError) {
        console.error("Error saving ticket attachments:", attachmentError);
      }
    }
  }

  await supabase.from("ticket_history").insert({
    ticket_id: ticket.id,
    user_id: user.id,
    action: "created",
    new_value: "Chamado vinculado criado",
  });

  revalidatePath("/chamados/manutencao");
  revalidatePath(`/chamados/manutencao/${parentTicketId}`);
  if (type === "compras") {
    revalidatePath("/chamados/compras");
  } else {
    revalidatePath("/chamados/ti");
  }

  return { ticketId: ticket.id };
}
