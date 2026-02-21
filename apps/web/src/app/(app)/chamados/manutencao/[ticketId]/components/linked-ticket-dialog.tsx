"use client";

import { useState, useTransition, useRef, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ShoppingCart,
  Monitor,
  FileText,
  Paperclip,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { createLinkedTicket } from "../../actions";

const UNITS_OF_MEASURE = [
  { value: "un", label: "Unidade(s)" },
  { value: "kg", label: "Quilograma(s)" },
  { value: "g", label: "Grama(s)" },
  { value: "l", label: "Litro(s)" },
  { value: "ml", label: "Mililitro(s)" },
  { value: "m", label: "Metro(s)" },
  { value: "m2", label: "Metro² (m²)" },
  { value: "m3", label: "Metro³ (m³)" },
  { value: "cx", label: "Caixa(s)" },
  { value: "pc", label: "Pacote(s)" },
  { value: "rl", label: "Rolo(s)" },
  { value: "par", label: "Par(es)" },
  { value: "jg", label: "Jogo(s)" },
  { value: "kit", label: "Kit(s)" },
];

interface LinkedTicketDialogProps {
  type: "compras" | "ti";
  parentTicketId: string;
  comprasCategories: { id: string; name: string }[];
  tiCategories: { id: string; name: string }[];
  disabled?: boolean;
}

export function LinkedTicketDialog({
  type,
  parentTicketId,
  comprasCategories,
  tiCategories,
  disabled = false,
}: LinkedTicketDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [perceivedUrgency, setPerceivedUrgency] = useState("");

  // Compras-specific
  const [itemName, setItemName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitOfMeasure, setUnitOfMeasure] = useState("un");
  const [estimatedPrice, setEstimatedPrice] = useState("");

  // TI-specific
  const [equipmentType, setEquipmentType] = useState("");

  const [attachments, setAttachments] = useState<File[]>([]);

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setCategoryId("");
    setPerceivedUrgency("");
    setItemName("");
    setQuantity("");
    setUnitOfMeasure("un");
    setEstimatedPrice("");
    setEquipmentType("");
    setAttachments([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setAttachments(Array.from(e.target.files));
    }
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!title || title.trim().length < 5) {
      toast.error("Título deve ter pelo menos 5 caracteres");
      return;
    }
    if (!description || description.trim().length < 10) {
      toast.error("Descrição deve ter pelo menos 10 caracteres");
      return;
    }

    const formData = new FormData();
    formData.set("title", title.trim());
    formData.set("description", description.trim());
    if (categoryId) formData.set("category_id", categoryId);
    if (perceivedUrgency) formData.set("perceived_urgency", perceivedUrgency);

    if (type === "compras") {
      if (itemName) formData.set("item_name", itemName.trim());
      if (quantity) formData.set("quantity", quantity);
      if (unitOfMeasure) formData.set("unit_of_measure", unitOfMeasure);
      if (estimatedPrice) formData.set("estimated_price", estimatedPrice);
    } else {
      if (equipmentType) formData.set("equipment_type", equipmentType.trim());
    }

    for (const file of attachments) {
      formData.append("attachments", file);
    }

    startTransition(async () => {
      const result = await createLinkedTicket(parentTicketId, type, formData);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success("Chamado vinculado criado com sucesso!");
      setOpen(false);
      resetForm();
      router.refresh();
    });
  };

  const categories = type === "compras" ? comprasCategories : tiCategories;

  return (
    <>
      <Button
        variant="outline"
        className="w-full gap-2"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        {type === "compras" ? (
          <ShoppingCart className="h-4 w-4" />
        ) : (
          <Monitor className="h-4 w-4" />
        )}
        {type === "compras" ? "Vincular Chamado de Compra" : "Vincular Chamado de TI"}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) resetForm();
          setOpen(v);
        }}
      >
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {type === "compras" ? (
                <ShoppingCart className="h-5 w-5 text-primary" />
              ) : (
                <Monitor className="h-5 w-5 text-primary" />
              )}
              {type === "compras" ? "Vincular Chamado de Compra" : "Vincular Chamado de TI"}
            </DialogTitle>
            <DialogDescription>
              Crie um chamado de {type === "compras" ? "Compras" : "TI"} vinculado a este chamado de
              manutenção. O novo chamado manterá a referência ao chamado
              original.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Título */}
            <div className="space-y-2">
              <Label htmlFor="linked_title">
                Título <span className="text-destructive">*</span>
              </Label>
              <Input
                id="linked_title"
                placeholder="Título do chamado vinculado"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            {/* Descrição */}
            <div className="space-y-2">
              <Label htmlFor="linked_description" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Descrição <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="linked_description"
                placeholder="Descreva a necessidade em detalhes..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                required
              />
            </div>

            <div className="grid grid-cols-1 gap-4">
              {/* Categoria */}
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Urgência */}
            <div className="space-y-2">
              <Label>Urgência Percebida</Label>
              <Select
                value={perceivedUrgency}
                onValueChange={setPerceivedUrgency}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Baixa</SelectItem>
                  <SelectItem value="medium">Média</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="urgent">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Campos específicos de Compras */}
            {type === "compras" && (
              <div className="space-y-4 rounded-md border p-4">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4" />
                  Dados do Item
                </h4>
                <div className="space-y-2">
                  <Label htmlFor="item_name">Nome do Item</Label>
                  <Input
                    id="item_name"
                    placeholder="Nome do item a ser comprado"
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="quantity">Quantidade</Label>
                    <Input
                      id="quantity"
                      type="number"
                      min="1"
                      step="1"
                      placeholder="1"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Unidade de Medida</Label>
                    <Select
                      value={unitOfMeasure}
                      onValueChange={setUnitOfMeasure}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UNITS_OF_MEASURE.map((um) => (
                          <SelectItem key={um.value} value={um.value}>
                            {um.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="estimated_price">Preço Est. (R$)</Label>
                    <Input
                      id="estimated_price"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0,00"
                      value={estimatedPrice}
                      onChange={(e) => setEstimatedPrice(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Campos específicos de TI */}
            {type === "ti" && (
              <div className="space-y-4 rounded-md border p-4">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <Monitor className="h-4 w-4" />
                  Dados de TI
                </h4>
                <div className="space-y-2">
                  <Label htmlFor="equipment_type">Tipo de Equipamento</Label>
                  <Input
                    id="equipment_type"
                    placeholder="Ex: Computador, Impressora, Câmera..."
                    value={equipmentType}
                    onChange={(e) => setEquipmentType(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Anexos */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Paperclip className="h-4 w-4" />
                Anexos
              </Label>
              <Input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                onChange={handleFileChange}
              />
              {attachments.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {attachments.length} arquivo(s) selecionado(s)
                </p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setOpen(false);
                  resetForm();
                }}
                disabled={isPending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  isPending || !title.trim() || !description.trim()
                }
              >
                {isPending ? "Criando..." : "Criar Chamado Vinculado"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
