"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Play,
  CheckCircle,
  XCircle,
  Truck,
  Package,
  Star,
  ArrowRight,
  Ban,
  Settings,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  changeTicketStatus,
  sendToApproval,
  sendToRequesterSelection,
} from "../../actions";
import { TriageDialog } from "./triage-dialog";
import { DeliveryRegistrationDialog } from "./delivery-registration-dialog";
import { DeliveryEvaluationDialog } from "./delivery-evaluation-dialog";
import { getTransitionPermission } from "../../constants";
import { hasPermission } from "@/lib/auth/rbac";
import type { Permission } from "@/lib/auth/permissions";

interface DepartmentMember {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  role: string;
}

interface TicketActionsProps {
  ticketId: string;
  ticketNumber: number;
  ticketTitle: string;
  currentStatus: string;
  canManage: boolean;
  canTriage: boolean;
  departmentMembers: DepartmentMember[];
  allowedTransitions: string[];
  perceivedUrgency?: string | null;
  items?: Array<{
    item_name: string;
    quantity: number;
    unit_of_measure: string | null;
  }>;
  isAdmin?: boolean;
  userRole?: string;
  userPermissions?: Permission[];
  hasSelectedQuotation?: boolean;
  isComprasMember?: boolean;
  isRequester?: boolean;
  canEvaluateDelivery?: boolean;
  quotationCount?: number;
  hasParentTicket?: boolean;
}

// Labels para status
const statusLabels: Record<string, string> = {
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

const statusActions: Record<
  string,
  {
    label: string;
    icon: React.ElementType;
    variant: "default" | "destructive" | "outline";
  }
> = {
  in_progress: { label: "Iniciar Andamento", icon: Play, variant: "default" },
  quoting: { label: "Iniciar Cotação", icon: Package, variant: "default" },
  approved: { label: "Aprovar", icon: CheckCircle, variant: "default" },
  purchasing: {
    label: "Executar Compra",
    icon: ArrowRight,
    variant: "default",
  },
  in_delivery: {
    label: "Enviar para Entrega",
    icon: Truck,
    variant: "default",
  },
  delivered: { label: "Confirmar Entrega", icon: Package, variant: "default" },
  evaluating: { label: "Avaliar Entrega", icon: Star, variant: "default" },
  closed: { label: "Fechar Chamado", icon: CheckCircle, variant: "default" },
  denied: { label: "Negar", icon: XCircle, variant: "destructive" },
  cancelled: { label: "Cancelar", icon: Ban, variant: "destructive" },
  awaiting_triage: {
    label: "Reenviar para Triagem",
    icon: ArrowRight,
    variant: "outline",
  },
};

export function TicketActions({
  ticketId,
  ticketNumber,
  ticketTitle,
  currentStatus,
  canManage,
  canTriage,
  departmentMembers,
  allowedTransitions,
  perceivedUrgency,
  items,
  isAdmin = false,
  userRole,
  userPermissions = [],
  hasSelectedQuotation = false,
  isComprasMember = false,
  isRequester = false,
  canEvaluateDelivery = false,
  quotationCount,
  hasParentTicket,
}: TicketActionsProps) {
  const router = useRouter();
  const [isDenyDialogOpen, setIsDenyDialogOpen] = useState(false);
  const [denyReason, setDenyReason] = useState("");
  const [isPending, startTransition] = useTransition();

  // Mostrar botão de triagem apenas se status é awaiting_triage e usuário pode triar
  const showTriageButton = currentStatus === "awaiting_triage" && canTriage;

  const showSendToSelectionButton =
    currentStatus === "quoting" &&
    isComprasMember &&
    hasParentTicket &&
    (quotationCount ?? 0) >= 2 &&
    (quotationCount ?? 0) <= 3;

  const showSendToApprovalButton =
    currentStatus === "quoting" &&
    isComprasMember &&
    !hasParentTicket &&
    hasSelectedQuotation;

  // Status finais que não podem ser fechados
  const finalStatuses = ["closed", "cancelled", "denied"];

  // Admin ou Gerente pode fechar chamados que não estão em status final e o botão não está nas transições
  // Correção BUG-014: Gerente também deve poder fechar chamados (requisito OPR-GER-013)
  const showCloseButton =
    (isAdmin || userRole === "Gerente") &&
    !finalStatuses.includes(currentStatus) &&
    !allowedTransitions.includes("closed");

  const handleStatusChange = (newStatus: string) => {
    if (newStatus === "denied") {
      setIsDenyDialogOpen(true);
      return;
    }

    startTransition(async () => {
      const result = await changeTicketStatus(ticketId, newStatus);

      if (result.error) {
        if (result.code === "conflict") {
          toast.warning(result.error);
          router.refresh();
          return;
        }
        toast.error(result.error);
        return;
      }

      toast.success(`Status alterado para: ${statusLabels[newStatus]}`);
      router.refresh();
    });
  };

  const handleDeny = () => {
    if (!denyReason.trim()) {
      toast.error("Informe o motivo da negação");
      return;
    }

    startTransition(async () => {
      const result = await changeTicketStatus(ticketId, "denied", denyReason);

      if (result.error) {
        if (result.code === "conflict") {
          toast.warning(result.error);
          router.refresh();
          return;
        }
        toast.error(result.error);
        return;
      }

      toast.success("Chamado negado");
      setIsDenyDialogOpen(false);
      setDenyReason("");
      router.refresh();
    });
  };

  const handleSendToApproval = () => {
    startTransition(async () => {
      const result = await sendToApproval(ticketId);

      if (result.error) {
        if (result.code === "conflict") {
          toast.warning(result.error);
          router.refresh();
          return;
        }
        toast.error(result.error);
        return;
      }

      toast.success("Chamado enviado para aprovação");
      router.refresh();
    });
  };

  const handleSendToSelection = () => {
    startTransition(async () => {
      const result = await sendToRequesterSelection(ticketId);

      if (result.error) {
        if (result.code === "conflict") {
          toast.warning(result.error);
          router.refresh();
          return;
        }
        toast.error(result.error);
        return;
      }

      toast.success("Chamado enviado para seleção do solicitante");
      router.refresh();
    });
  };

  // Verificar se há ações de gerenciamento disponíveis
  const hasManageActions = canManage && allowedTransitions.length > 0;

  // Não mostrar card se não há NENHUMA ação disponível
  // CORREÇÃO BUG-012: Usar && ao invés de || para permitir triagem mesmo sem canManage
  if (
    !showTriageButton &&
    !hasManageActions &&
    !showCloseButton &&
    !showSendToApprovalButton &&
    !showSendToSelectionButton &&
    !canEvaluateDelivery
  ) {
    return null;
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Ações
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Botão de Triagem (componente separado com dialog melhorado) */}
          {showTriageButton && (
            <TriageDialog
              ticketId={ticketId}
              ticketNumber={ticketNumber}
              ticketTitle={ticketTitle}
              perceivedUrgency={perceivedUrgency}
              departmentMembers={departmentMembers}
              items={items}
              disabled={isPending}
            />
          )}

          {showSendToSelectionButton && (
            <Button
              variant="default"
              className="w-full gap-2"
              onClick={handleSendToSelection}
              disabled={isPending}
            >
              <Users className="h-4 w-4" />
              Enviar para Seleção
            </Button>
          )}

          {/* Botão "Enviar para Aprovação" manual (Compras, status quoting, cotação selecionada) */}
          {showSendToApprovalButton && (
            <Button
              variant="default"
              className="w-full gap-2"
              onClick={handleSendToApproval}
              disabled={isPending}
            >
              <ArrowRight className="h-4 w-4" />
              Enviar para Aprovação
            </Button>
          )}

          {/* Botões de Transição de Status - só para quem pode gerenciar */}
          {canManage &&
            allowedTransitions
              .filter((status) => {
                // Excluir transições com dialogs dedicados do loop genérico
                if (status === "evaluating") return false;
                // Filtrar transições baseado em permissões (dupla validação: server + client)
                const requiredPermission = getTransitionPermission(status);
                if (requiredPermission === null) {
                  return true; // Sem restrição específica
                }
                return hasPermission(userPermissions, requiredPermission as Permission);
              })
              .map((status) => {
                // Interceptar transição in_delivery com dialog dedicado
                if (status === "in_delivery") {
                  return (
                    <DeliveryRegistrationDialog
                      key={status}
                      ticketId={ticketId}
                      disabled={isPending}
                    />
                  );
                }

                const action = statusActions[status];
                if (!action) return null;

                const Icon = action.icon;

                return (
                  <Button
                    key={status}
                    variant={action.variant}
                    className="w-full gap-2"
                    onClick={() => handleStatusChange(status)}
                    disabled={isPending}
                  >
                    <Icon className="h-4 w-4" />
                    {action.label}
                  </Button>
                );
              })}

          {/* Botão "Avaliar Entrega" — apenas o solicitante, baseado no status bruto (sem filtro de permissão) */}
          {canEvaluateDelivery && (
            <DeliveryEvaluationDialog
              ticketId={ticketId}
              disabled={isPending}
            />
          )}

          {/* Botão de Fechar para Admin/Gerente (quando não está nas transições normais) */}
          {showCloseButton && (
            <Button
              variant="default"
              className="w-full gap-2"
              onClick={() => handleStatusChange("closed")}
              disabled={isPending}
            >
              <CheckCircle className="h-4 w-4" />
              Fechar Chamado
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Dialog de Negação */}
      <Dialog open={isDenyDialogOpen} onOpenChange={setIsDenyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Negar Chamado</DialogTitle>
            <DialogDescription>
              Informe o motivo da negação. Esta informação será visível para o
              solicitante.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="deny_reason">Motivo da Negação *</Label>
              <Textarea
                id="deny_reason"
                placeholder="Explique o motivo da negação..."
                value={denyReason}
                onChange={(e) => setDenyReason(e.target.value)}
                rows={4}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDenyDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeny}
              disabled={isPending || !denyReason.trim()}
            >
              {isPending ? "Processando..." : "Confirmar Negação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
