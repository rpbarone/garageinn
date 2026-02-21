"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, X, Loader2 } from "lucide-react";
import { STATUS_LABELS, PRIORITY_LABELS } from "../../components/status-badge";
import type { TiCategory } from "../types";
import type { UserUnit } from "@/lib/units";

interface TiFiltersProps {
  categories: TiCategory[];
  units: UserUnit[];
}

const STATUS_OPTIONS = [
  { value: "all", label: "Todos os status" },
  {
    value: "awaiting_approval_encarregado",
    label: STATUS_LABELS.awaiting_approval_encarregado,
  },
  {
    value: "awaiting_approval_supervisor",
    label: STATUS_LABELS.awaiting_approval_supervisor,
  },
  {
    value: "awaiting_approval_gerente",
    label: STATUS_LABELS.awaiting_approval_gerente,
  },
  { value: "awaiting_triage", label: "Pronto para Execução" },
  { value: "in_progress", label: STATUS_LABELS.in_progress },
  { value: "executing", label: STATUS_LABELS.executing },
  { value: "waiting_parts", label: STATUS_LABELS.waiting_parts },
  { value: "resolved", label: STATUS_LABELS.resolved },
  { value: "closed", label: STATUS_LABELS.closed },
  { value: "denied", label: STATUS_LABELS.denied },
  { value: "cancelled", label: STATUS_LABELS.cancelled },
];

const PRIORITY_OPTIONS = [
  { value: "all", label: "Todas as prioridades" },
  { value: "low", label: PRIORITY_LABELS.low },
  { value: "medium", label: PRIORITY_LABELS.medium },
  { value: "high", label: PRIORITY_LABELS.high },
  { value: "urgent", label: PRIORITY_LABELS.urgent },
];

export function TiFilters({ categories, units }: TiFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const parentTicketInputRef = useRef<HTMLInputElement>(null);

  const updateFilter = useCallback(
    (key: string, value: string) => {
      startTransition(() => {
        const params = new URLSearchParams(searchParams.toString());
        if (value && value !== "all") {
          params.set(key, value);
        } else {
          params.delete(key);
        }
        params.delete("page");
        router.push(`?${params.toString()}`);
      });
    },
    [router, searchParams]
  );

  const handleSearch = useCallback(() => {
    updateFilter("search", search);
  }, [search, updateFilter]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSearch();
      }
    },
    [handleSearch]
  );

  const handleParentTicketIdApply = useCallback(() => {
    const value = parentTicketInputRef.current?.value?.trim() || "";
    updateFilter("parent_ticket_id", value);
  }, [updateFilter]);

  const clearFilters = useCallback(() => {
    startTransition(() => {
      setSearch("");
      if (parentTicketInputRef.current) {
        parentTicketInputRef.current.value = "";
      }
      router.push("/chamados/ti");
    });
  }, [router]);

  const hasFilters =
    searchParams.get("search") ||
    searchParams.get("status") ||
    searchParams.get("priority") ||
    searchParams.get("category_id") ||
    searchParams.get("unit_id") ||
    searchParams.get("parent_ticket_id");

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por titulo ou numero..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pl-10"
          />
        </div>
        <Button onClick={handleSearch} disabled={isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
        </Button>
      </div>

      <div className="flex flex-wrap gap-4">
        <Select
          value={searchParams.get("status") || "all"}
          onValueChange={(value) => updateFilter("status", value)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={searchParams.get("priority") || "all"}
          onValueChange={(value) => updateFilter("priority", value)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Prioridade" />
          </SelectTrigger>
          <SelectContent>
            {PRIORITY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={searchParams.get("category_id") || "all"}
          onValueChange={(value) => updateFilter("category_id", value)}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as categorias</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={searchParams.get("unit_id") || "all"}
          onValueChange={(value) => updateFilter("unit_id", value)}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Unidade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as unidades</SelectItem>
            {units.map((unit) => (
              <SelectItem key={unit.id} value={unit.id}>
                {unit.code} - {unit.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <Input
            key={searchParams.get("parent_ticket_id") || ""}
            ref={parentTicketInputRef}
            placeholder="Chamado pai (ID ou número)"
            defaultValue={searchParams.get("parent_ticket_id") || ""}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleParentTicketIdApply();
              }
            }}
            className="w-[200px]"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleParentTicketIdApply}
            disabled={isPending}
          >
            Filtrar
          </Button>
        </div>

        {hasFilters && (
          <Button variant="ghost" onClick={clearFilters} disabled={isPending}>
            <X className="mr-2 h-4 w-4" />
            Limpar Filtros
          </Button>
        )}
      </div>
    </div>
  );
}
