// Constantes e tipos para chamados de compras

// Transições de status permitidas
export const statusTransitions: Record<string, string[]> = {
  awaiting_approval_encarregado: ["awaiting_approval_supervisor", "denied"],
  awaiting_approval_supervisor: ["awaiting_approval_gerente", "denied"],
  awaiting_approval_gerente: ["awaiting_triage", "denied"],
  awaiting_triage: ["in_progress", "quoting", "denied"],
  in_progress: ["quoting", "denied", "cancelled"],
  quoting: ["awaiting_requester_selection", "approved", "denied"],
  awaiting_requester_selection: ["approved", "denied"],
  awaiting_approval: ["approved", "denied"],
  approved: ["purchasing"],
  purchasing: ["in_delivery"],
  in_delivery: ["delivered"],
  delivered: ["evaluating"],
  evaluating: ["closed"],
  denied: ["awaiting_triage"], // Pode reenviar
  closed: [],
  cancelled: [],
};

// Labels para status
export const statusLabels: Record<string, string> = {
  awaiting_approval_encarregado: "Aguardando Aprovação (Encarregado)",
  awaiting_approval_supervisor: "Aguardando Aprovação (Supervisor)",
  awaiting_approval_gerente: "Aguardando Aprovação (Gerente)",
  awaiting_triage: "Aguardando Triagem",
  in_progress: "Em Andamento",
  quoting: "Em Cotação",
  awaiting_requester_selection: "Aguardando Seleção do Solicitante",
  awaiting_approval: "Aguardando Aprovação",
  approved: "Aprovado",
  purchasing: "Executando Compra",
  in_delivery: "Em Entrega",
  delivered: "Entrega Realizada",
  evaluating: "Em Avaliação",
  closed: "Fechado",
  denied: "Negado",
  cancelled: "Cancelado",
};

export const APPROVAL_STATUSES = [
  "awaiting_approval_encarregado",
  "awaiting_approval_supervisor",
  "awaiting_approval_gerente",
] as const;

export const GERENTE_APPROVAL_STATUS = "awaiting_approval_gerente";

// Obtém transições permitidas para um status
export function getAllowedTransitions(currentStatus: string): string[] {
  return statusTransitions[currentStatus] || [];
}

/**
 * Mapeamento de permissões necessárias para cada transição de status
 * 
 * - "tickets:approve": Aprovar ou negar chamados (apenas Gerente)
 * - "tickets:execute": Executar ações operacionais (Comprador, Gerente)
 * - null: Sem restrição de permissão específica (qualquer usuário com canManage)
 */
export const transitionPermissions: Record<string, "tickets:approve" | "tickets:execute" | null> = {
  // Transições que requerem aprovação (apenas Gerente)
  approved: "tickets:approve",
  denied: "tickets:approve",
  
  // Transições operacionais (Comprador e Gerente)
  in_progress: "tickets:execute",
  quoting: "tickets:execute",
  purchasing: "tickets:execute",
  in_delivery: "tickets:execute",
  delivered: "tickets:execute",
  evaluating: "tickets:execute",
  closed: "tickets:execute",
  cancelled: "tickets:execute",
  
  // Transições sem restrição específica (herdam de canManage)
  awaiting_approval: null,
  awaiting_approval_encarregado: null,
  awaiting_approval_supervisor: null,
  awaiting_approval_gerente: null,
  awaiting_triage: null,
  awaiting_requester_selection: "tickets:execute",
};

/**
 * Verifica se uma transição requer uma permissão específica
 */
export function getTransitionPermission(transition: string): "tickets:approve" | "tickets:execute" | null {
  return transitionPermissions[transition] ?? null;
}
