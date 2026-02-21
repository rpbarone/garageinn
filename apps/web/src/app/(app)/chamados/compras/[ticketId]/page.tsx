import { notFound } from "next/navigation";
import { Metadata } from "next";
import {
  getTicketDetails,
  canManageTicket,
  canTriageTicket,
  getComprasDepartmentMembers,
  getCurrentUser,
  checkIsAdmin,
  getCurrentUserPermissions,
  getIsInteressado,
} from "../actions";
import { getAllowedTransitions, getTransitionPermission } from "../constants";
import { hasPermission } from "@/lib/auth/rbac";
import type { Permission } from "@/lib/auth/permissions";
import { AccessDenied } from "@/components/auth/access-denied";
import {
  TicketHeader,
  TicketInfo,
  TicketTimeline,
  TicketComments,
  TicketQuotations,
  TicketApprovals,
  TicketActions,
  QuotationSelectionDialog,
} from "./components";
import { DeleteTicketButton, ParentTicketBanner } from "../../components";

interface PageProps {
  params: Promise<{ ticketId: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { ticketId } = await params;
  const ticket = await getTicketDetails(ticketId);

  if (!ticket) {
    return { title: "Chamado não encontrado" };
  }

  if ("accessDenied" in ticket && ticket.accessDenied) {
    return { title: "Acesso negado | Chamados de Compras" };
  }

  return {
    title: `#${ticket.ticket_number} - ${ticket.title} | Chamados de Compras`,
    description: ticket.description?.slice(0, 160),
  };
}

export default async function TicketDetailsPage({ params }: PageProps) {
  const { ticketId } = await params;

  // Buscar dados em paralelo
  const [
    ticket,
    canManage,
    canTriage,
    departmentMembers,
    currentUser,
    isAdmin,
    userPermissions,
    isInteressado,
  ] = await Promise.all([
    getTicketDetails(ticketId),
    canManageTicket(ticketId),
    canTriageTicket(),
    getComprasDepartmentMembers(),
    getCurrentUser(),
    checkIsAdmin(),
    getCurrentUserPermissions(),
    getIsInteressado(ticketId),
  ]);

  if (!ticket) {
    notFound();
  }

  if ("accessDenied" in ticket && ticket.accessDenied) {
    return (
      <div className="container mx-auto py-6">
        <AccessDenied
          title="Acesso negado"
          description="Voce nao tem permissao para visualizar este chamado."
          actionHref="/chamados/compras"
          actionLabel="Voltar para chamados"
        />
      </div>
    );
  }

  // Determinar o cargo do usuário atual (para aprovações)
  const currentUserRole = currentUser?.id
    ? await getUserRole(currentUser.id)
    : undefined;

  const isRequester = currentUser?.id === ticket.created_by;
  const isComprasMember = canManage;
  const hasSelectedQuotation = ticket.quotations?.some((q: { is_selected?: boolean }) => q.is_selected) ?? false;
  const quotationCount = ticket.quotations?.length ?? 0;

  // Obter transições permitidas para o status atual
  const rawTransitions = getAllowedTransitions(ticket.status);
  
  // Filtrar transições baseado em permissões do usuário
  const allowedTransitions = rawTransitions.filter((transition) => {
    const requiredPermission = getTransitionPermission(transition);
    if (requiredPermission === null) {
      return true;
    }
    return hasPermission(userPermissions, requiredPermission as Permission);
  });

  // O solicitante pode avaliar quando o status permite "evaluating", independente das permissões de execução
  const canEvaluateDelivery = isRequester && rawTransitions.includes("evaluating");

  // Verificar se tem aprovações pendentes (para mostrar a seção de aprovações)
  const hasApprovals = ticket.approvals && ticket.approvals.length > 0;

  return (
    <div className="container mx-auto py-6 space-y-6">
      {ticket.parent_ticket && (
        <ParentTicketBanner parentTicket={ticket.parent_ticket} />
      )}
      {/* Header */}
      <TicketHeader ticket={ticket} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Coluna Principal */}
        <div className="lg:col-span-2 space-y-6">
          {/* Informações do Item e Justificativa */}
          <TicketInfo ticket={ticket} />

          {/* Seleção de cotação pelo solicitante */}
          {isInteressado &&
            ticket.status === "awaiting_requester_selection" &&
            ticket.quotations?.length > 0 && (
            <QuotationSelectionDialog
              ticketId={ticketId}
              quotations={ticket.quotations}
              mode="requester"
            />
          )}

          {/* Aprovações (se existirem) */}
          {hasApprovals && (
            <TicketApprovals
              ticketId={ticketId}
              approvals={ticket.approvals}
              ticketStatus={ticket.status}
              currentUserRole={currentUserRole}
              isAdmin={isAdmin}
            />
          )}

          {/* Cotações */}
          <TicketQuotations
            ticketId={ticketId}
            quotations={ticket.quotations}
            canManage={canManage}
            ticketStatus={ticket.status}
            itemQuantity={ticket.items_total_quantity ?? ticket.quantity}
            items={ticket.items}
          />

          {/* Comentários */}
          <TicketComments
            ticketId={ticketId}
            comments={ticket.comments}
            canManage={canManage}
          />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Ações */}
          <TicketActions
            ticketId={ticketId}
            ticketNumber={ticket.ticket_number}
            ticketTitle={ticket.title}
            currentStatus={ticket.status}
            canManage={canManage}
            canTriage={canTriage}
            departmentMembers={departmentMembers}
            allowedTransitions={allowedTransitions}
            perceivedUrgency={ticket.perceived_urgency}
            items={ticket.items}
            isAdmin={isAdmin}
            userRole={currentUserRole}
            userPermissions={userPermissions}
            hasSelectedQuotation={hasSelectedQuotation}
            isComprasMember={isComprasMember}
            isRequester={isRequester}
            canEvaluateDelivery={canEvaluateDelivery}
            quotationCount={quotationCount}
            hasParentTicket={!!ticket.parent_ticket_id}
          />

          {/* Timeline / Histórico */}
          <TicketTimeline history={ticket.history} />

          {/* Botão de Excluir (apenas para Admin) */}
          {isAdmin && (
            <div className="pt-4 border-t">
              <DeleteTicketButton
                ticketId={ticketId}
                ticketNumber={ticket.ticket_number}
                ticketTitle={ticket.title}
                redirectTo="/chamados/compras"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Função auxiliar para obter o cargo do usuário em Operações (para aprovações)
async function getUserRole(userId: string): Promise<string | undefined> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();

  // Buscar o cargo mais alto do usuário no departamento Operações
  // Prioridade: Gerente > Supervisor > Encarregado > Manobrista
  const { data } = await supabase
    .from("user_roles")
    .select(
      `
      role:roles!role_id(
        name,
        department:departments!department_id(name)
      )
    `
    )
    .eq("user_id", userId);

  if (!data || data.length === 0) return undefined;

  // Filtrar apenas cargos de Operações e ordenar por hierarquia
  const roleHierarchy: Record<string, number> = {
    Gerente: 4,
    Supervisor: 3,
    Encarregado: 2,
    Manobrista: 1,
  };

  const operacoesRoles = data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((r: any) => r.role?.department?.name === "Operações")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((r: any) => r.role?.name)
    .filter(Boolean)
    .sort((a: string, b: string) => (roleHierarchy[b] || 0) - (roleHierarchy[a] || 0));

  return operacoesRoles[0];
}
