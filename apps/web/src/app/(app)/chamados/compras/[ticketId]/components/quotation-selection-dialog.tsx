"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { selectQuotation, selectQuotationByRequester } from "../../actions";
import { cn } from "@/lib/utils";

interface Quotation {
  id: string;
  supplier_name: string;
  total_price: number;
  payment_terms?: string | null;
  delivery_deadline?: string | null;
  is_selected?: boolean;
}

interface QuotationSelectionDialogProps {
  ticketId: string;
  quotations: Quotation[];
  disabled?: boolean;
  mode?: "compras" | "requester";
}

export function QuotationSelectionDialog({
  ticketId,
  quotations,
  disabled,
  mode = "compras",
}: QuotationSelectionDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => quotations.find((q) => q.is_selected)?.id ?? null
  );
  const [isPending, startTransition] = useTransition();

  const handleConfirm = () => {
    if (!selectedId) {
      toast.error("Selecione uma cotação");
      return;
    }

    startTransition(async () => {
      const result =
        mode === "requester"
          ? await selectQuotationByRequester(ticketId, selectedId)
          : await selectQuotation(ticketId, selectedId);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success("Cotação selecionada com sucesso");
      setOpen(false);
      router.refresh();
    });
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full gap-2" disabled={disabled}>
          <ListChecks className="h-4 w-4" />
          Selecionar Cotação
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Selecionar Cotação</DialogTitle>
          <DialogDescription>
            {mode === "requester"
              ? "Escolha a cotação que melhor atende à necessidade da sua equipe. Após a confirmação, o chamado será encaminhado para execução."
              : "Escolha a cotação que melhor atende à sua necessidade."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-80 overflow-y-auto py-2">
          {quotations.map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => setSelectedId(q.id)}
              className={cn(
                "w-full rounded-lg border p-4 text-left transition-colors",
                selectedId === q.id
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                  : "border-border hover:border-primary/40"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <p className="font-medium">{q.supplier_name}</p>
                  <p className="text-lg font-semibold text-primary">
                    {formatCurrency(q.total_price)}
                  </p>
                  {q.payment_terms && (
                    <p className="text-sm text-muted-foreground">
                      Pagamento: {q.payment_terms}
                    </p>
                  )}
                  {q.delivery_deadline && (
                    <p className="text-sm text-muted-foreground">
                      Entrega: {new Date(q.delivery_deadline).toLocaleDateString("pt-BR")}
                    </p>
                  )}
                </div>
                {selectedId === q.id && (
                  <CheckCircle className="h-5 w-5 shrink-0 text-primary" />
                )}
              </div>
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isPending || !selectedId}
          >
            {isPending ? "Salvando..." : "Confirmar Seleção"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
