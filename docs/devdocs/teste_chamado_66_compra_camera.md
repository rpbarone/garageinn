# Teste de Chamado de Compras #66 — "Compra de camera"

**Data do teste:** 21/02/2026
**ID:** `1c3c02b3-3ebc-4986-9bcd-a5d3dc3ab50c`
**Tipo:** Compras (originado de Manutenção)

---

## 1. Objetivo do Teste

Validar o fluxo completo de um chamado de compras gerado a partir de um chamado-pai de manutenção, verificando:

- Criação correta do vínculo pai-filho (Manutenção → Compras)
- Fluxo de aprovação hierárquica do chamado-pai
- Transições de status do chamado de compras
- Registro de cotações
- Registro de comentários
- Regras de RBAC e aprovação

---

## 2. Dados do Chamado

| Campo | Valor |
|---|---|
| **Ticket Number** | #66 |
| **Título** | Compra de camera |
| **Descrição** | Precisa comprar uma camera nova |
| **Departamento** | Compras e Manutenção (`1973b68b-eed0-440d-9ed3-036f26ebf6f4`) |
| **Status Atual** | `quoting` (Em Cotação) |
| **Criado por** | Teste Comprador - Compras e Manutenção (`052892bf-...`) |
| **Criado em** | 21/02/2026 03:31:49 UTC |
| **Última atualização** | 21/02/2026 03:32:47 UTC |
| **Chamado Pai** | #65 — "Vazamento no teto" (`3879088b-...`) |
| **Tipo de Origem** | `manutencao` |
| **Unidade** | `null` (não atribuída) |
| **Prioridade** | `null` (não definida) |
| **Atribuído a** | `null` (ninguém atribuído) |

---

## 3. Chamado Pai (#65 — "Vazamento no teto")

O chamado #66 foi criado como filho do chamado de manutenção #65, simulando o cenário descrito nos requisitos: um vazamento no teto que queimou a câmera, necessitando compra de uma nova.

| Campo | Valor |
|---|---|
| **Ticket Number** | #65 |
| **Título** | Vazamento no teto |
| **Departamento** | Compras e Manutenção |
| **Status Atual** | `executing` (Em Execução) |
| **Criado em** | 21/02/2026 02:25:13 UTC |

---

## 4. Timeline Completa (Logs de Histórico)

### 4.1 Chamado Pai #65 — Fluxo de Aprovação Hierárquica

| # | Horário (UTC) | Ação | De → Para | Responsável | Observação |
|---|---|---|---|---|---|
| 1 | 02:25:13 | Criação | — → `awaiting_approval_encarregado` | _(criador original)_ | Chamado aberto no nível mais baixo |
| 2 | 02:29:13 | Aprovação Nível 1 | `awaiting_approval_encarregado` → `awaiting_approval_supervisor` | **Teste Encarregado - Operações** | Aprovação ~4min após criação |
| 3 | 02:29:40 | Aprovação Nível 2 | `awaiting_approval_supervisor` → `awaiting_approval_gerente` | **Teste Supervisor - Operações** | ~27s entre aprovações |
| 4 | 02:30:36 | Aprovação Nível 3 | `awaiting_approval_gerente` → `awaiting_triage` | **Teste Gerente - Operações** | Último nível de aprovação |
| 5 | 03:29:35 | Triagem | `awaiting_triage` → `in_progress` | **Teste Comprador - Compras e Manutenção** | Comprador assumiu ~59min depois |
| 6 | 03:31:17 | Em Execução | `in_progress` → `executing` | **Teste Comprador - Compras e Manutenção** | Status final atual do pai |

**Conclusão:** A cadeia de aprovação hierárquica (Encarregado → Supervisor → Gerente → Triagem) funcionou corretamente. O Comprador de Compras e Manutenção conseguiu fazer a triagem e iniciar a execução.

---

### 4.2 Chamado Filho #66 — Fluxo de Compras

| # | Horário (UTC) | Ação | De → Para | Responsável | Observação |
|---|---|---|---|---|---|
| 1 | 03:31:49 | Criação | — → `awaiting_triage` | **Teste Comprador - Compras e Manutenção** | Criado como filho do #65 |
| 2 | 03:32:41 | Triagem | `awaiting_triage` → `in_progress` | **Teste Comprador - Compras e Manutenção** | ~52s após criação |
| 3 | 03:32:47 | Em Cotação | `in_progress` → `quoting` | **Teste Comprador - Compras e Manutenção** | ~6s depois; status atual |
| 4 | 03:33:19 | Cotação #1 adicionada | — | **Teste Comprador** | Empresa teste — R$ 289,00 |
| 5 | 03:33:46 | Cotação #2 adicionada | — | **Teste Comprador** | Empresa teste 2 — R$ 295,00 |
| 6 | 03:35:13 | Comentário | — | **Teste Comprador** | "Comentário teste" |

**Conclusão:** O chamado de compras foi criado já no status `awaiting_triage` (sem passar pela cadeia de aprovação Encarregado/Supervisor/Gerente), pois foi gerado internamente pelo Comprador. As transições `awaiting_triage → in_progress → quoting` ocorreram corretamente.

---

## 5. Item de Compra

| Item | Quantidade | Unidade | Preço Estimado |
|---|---|---|---|
| Camera teste | 1 | un | R$ 350,00 |

Registrado em `ticket_purchase_details` e `ticket_purchase_items` (ambas com dados consistentes).

---

## 6. Cotações Registradas

| # | Fornecedor | CNPJ | Qtd | Preço Unit. | Total | Prazo Entrega | Status | Selecionada |
|---|---|---|---|---|---|---|---|---|
| 1 | empresa teste | — | 1 | R$ 289,00 | R$ 289,00 | 23/02/2026 | `pending` | **Não** |
| 2 | Empresa teste 2 | — | 1 | R$ 295,00 | R$ 295,00 | 21/02/2026 | `pending` | **Não** |

**Conclusão:** As cotações foram inseridas corretamente. Nenhuma foi selecionada (`is_selected: false`). Campos opcionais (CNPJ, contato, condições de pagamento, notas) ficaram `null`.

---

## 7. Comentários

| Horário (UTC) | Usuário | Conteúdo | Interno |
|---|---|---|---|
| 03:35:13 | `052892bf-...` (Teste Comprador) | "Comentário teste" | Não |

---

## 8. Aprovações e Anexos

| Recurso | Resultado |
|---|---|
| **ticket_approvals** | Nenhum registro (esperado neste estágio) |
| **ticket_attachments** | Nenhum registro |

---

## 9. Análise de RBAC e Aprovação

### 9.1 Quem pode aprovar chamados de Compras?

A análise de código revelou que a aprovação de chamados de compras segue duas verificações:

1. **`canManageTicket`** — Verifica se o usuário pertence ao departamento **Compras e Manutenção** (`role.department_id === comprasDept.id`). Isso exclui gerentes de outros departamentos (Operações, Financeiro, etc.).

2. **Permissão `tickets:approve`** — Dentro de Compras e Manutenção, somente o cargo **Gerente** possui essa permissão.

| Cargo | Departamento | `canManageTicket` | `tickets:approve` | Pode aprovar? |
|---|---|---|---|---|
| Gerente | **Compras e Manutenção** | Sim | Sim | **Sim** |
| Comprador | Compras e Manutenção | Sim | Não | Não |
| Assistente | Compras e Manutenção | Sim | Não | Não |
| Gerente | Operações | **Não** | Sim (no próprio dept.) | **Não** |
| Desenvolvedor/Diretor/Admin | Global | Sim (admin) | Sim (admin:all) | **Sim** |

### 9.2 Caso especial: Gerente de Compras abrindo chamado

Existe uma validação especial em `ensureComprasPurchaseApproval`: se o **criador** do chamado for um Gerente, a aprovação precisa ser feita pelo **Diretor** (via `get_purchase_approver` RPC). Isso impede que o Gerente aprove seus próprios chamados.

### 9.3 Fluxo "Enviar para Aprovação" (`sendToApproval`)

Existe uma ação `sendToApproval` que move o chamado de `quoting` → `awaiting_approval`. Requisitos:
- O chamado precisa estar em `quoting`
- O usuário precisa ser membro de Compras (`canManageTicket`)
- Precisa ter **ao menos uma cotação selecionada** (`is_selected: true`)

O status `awaiting_approval` é um estágio intermediário onde o aprovador (Gerente de Compras) avalia e decide entre `approved` ou `denied`.

---

## 10. Divergência Identificada: Requisito vs. Implementação

### O que diz o requisito de negócio (`tasks_0602.md`, linha 14):

> "Quando o departamento de compras trabalha nos orçamentos e conclui, precisa mandar para o **solicitante** escolher uma compra, ou seja, aprovar uma compra. Ele vai selecionar qual ele quer. Só vai para o aprovador/aprovação manualmente; Ex.: Enviar para aprovação"

### O que está implementado:

O fluxo atual envia para aprovação do **Gerente de Compras e Manutenção**, não para o **solicitante** (departamento que originou o chamado — neste caso, Operações).

| Aspecto | Requisito | Implementação Atual |
|---|---|---|
| Quem escolhe a cotação | Solicitante (dept. de origem) | Comprador de Compras (quem gerencia) |
| Quem aprova | Solicitante seleciona + Enviar para aprovação | Gerente de Compras e Manutenção |
| Fluxo manual | "Enviar para aprovação" (botão) | Existe (`sendToApproval`), mas envia para Gerente de Compras |

**Possível gap:** O requisito sugere que o **solicitante** (Gerente de Operações, no caso do chamado #65/#66) deveria poder visualizar as cotações e escolher qual prefere antes de encaminhar para aprovação formal. Atualmente, essa escolha e aprovação ficam restritas ao departamento de Compras.

---

## 11. Workflow Completo de Status (Compras)

```
[Criação]
    │
    ▼
awaiting_approval_encarregado ──→ awaiting_approval_supervisor ──→ awaiting_approval_gerente
    │ (pode ser pulado se criado internamente por Compras)          │
    │                                                                ▼
    │                                                          awaiting_triage
    │                                                                │
    ▼ ◄──────────────────────────────────────────────────────────────┘
awaiting_triage
    │
    ├──→ in_progress ──→ quoting ──→ [awaiting_approval] ──→ approved ──→ purchasing
    │                       │                 │                               │
    │                       ├──→ denied ◄─────┤                          in_delivery
    │                       │                                                │
    │                       ▼                                            delivered
    │                    approved                                            │
    │                                                                   evaluating
    │                                                                        │
    └──→ denied ──→ awaiting_triage (reenvio)                            closed
```

### Transições permitidas por status:

| Status Atual | Próximos Status Permitidos |
|---|---|
| `awaiting_triage` | `in_progress`, `quoting`, `denied` |
| `in_progress` | `quoting`, `denied`, `cancelled` |
| `quoting` | `approved`, `denied` |
| `awaiting_approval` | `approved`, `denied` |
| `approved` | `purchasing` |
| `purchasing` | `in_delivery` |
| `in_delivery` | `delivered` |
| `delivered` | `evaluating` |
| `evaluating` | `closed` |
| `denied` | `awaiting_triage` (reenvio) |
| `closed` | _(final)_ |
| `cancelled` | _(final)_ |

---

## 12. Próximos Passos para o Chamado #66

O chamado está em `quoting` (Em Cotação). Para avançar:

1. **Selecionar uma cotação** — Marcar `is_selected: true` em uma das duas cotações (atualmente ambas `is_selected: false`)
2. **Enviar para aprovação** — Usar `sendToApproval` (muda para `awaiting_approval`) ou aprovar diretamente (`quoting → approved`)
3. **Gerente de Compras aprova** — Transição para `approved`
4. **Executar compra** → `purchasing`
5. **Registrar entrega** → `in_delivery` → `delivered`
6. **Avaliar** → `evaluating` → `closed`

---

## 13. Conclusões do Teste

### O que funcionou corretamente

| Item | Status |
|---|---|
| Cadeia de aprovação hierárquica do chamado pai (Encarregado → Supervisor → Gerente) | OK |
| Criação do chamado filho vinculado ao pai (`parent_ticket_id` preenchido) | OK |
| Campo `origin_ticket_type: manutencao` corretamente preenchido | OK |
| Transições de status do chamado de compras (`awaiting_triage → in_progress → quoting`) | OK |
| Registro de cotações com múltiplos fornecedores | OK |
| Registro de comentários | OK |
| Registro de histórico (`ticket_history`) com ação, valores antigo/novo e usuário | OK |
| RBAC: Comprador tem `tickets:execute` e consegue operar o chamado | OK |
| Validação de `canManageTicket` restrita ao departamento de Compras | OK |

### Pontos de atenção / Possíveis melhorias

| # | Item | Severidade | Descrição |
|---|---|---|---|
| 1 | **Aprovação pelo solicitante** | Média | Requisito de negócio diz que o solicitante (dept. origem) deveria escolher a cotação antes de enviar para aprovação formal. Implementação atual mantém tudo dentro de Compras. |
| 2 | **Unidade não atribuída** | Baixa | `unit_id` é `null`. Dependendo do processo, pode ser relevante vincular à unidade do chamado pai. |
| 3 | **Prioridade não definida** | Baixa | `priority` e `perceived_urgency` estão `null`. Pode dificultar priorização no painel. |
| 4 | **Nenhum responsável atribuído** | Baixa | `assigned_to` é `null`. A triagem não atribuiu formalmente o chamado. |
| 5 | **CNPJ dos fornecedores** | Informativo | Campos `supplier_cnpj` e `supplier_contact` estão `null` nas cotações. Pode ser útil tornar obrigatório. |
| 6 | **Anexos ausentes** | Informativo | Nenhum anexo foi adicionado. Requisitos mencionam "Deve poder pôr anexos". Funcionalidade existe mas não foi testada. |
| 7 | **Transição `quoting → awaiting_approval`** | Informativo | Existe via `sendToApproval` (requer cotação selecionada), mas `statusTransitions` em `constants.ts` não inclui `awaiting_approval` como transição de `quoting`. O `sendToApproval` funciona por bypass direto. |

---

## 14. Testes de RBAC — Acesso ao Chamado Pai #65 por Diferentes Cargos

Testes realizados na mesma sessão (21/02/2026) para validar o comportamento da interface ao acessar o chamado de manutenção #65 ("Vazamento no teto") com diferentes perfis do departamento de Compras e Manutenção.

**URL testada:** `https://garageinn.vercel.app/chamados/manutencao/3879088b-7aa6-4fc2-80ff-4e1ce55a6448`

### 14.1 Teste: Cargo Assistente

| Campo | Valor |
|---|---|
| **Usuário** | Teste Assistente - Compras e Manutenção |
| **Email** | assistente_compras_e_manutencao_teste@garageinn.com |
| **Cargo** | Assistente |
| **Permissões** | `tickets:read` |

**Status do chamado no momento do teste:** `awaiting_triage`

#### Resultado na Interface

| Elemento | Visível? | Habilitado? | Observação |
|---|---|---|---|
| Detalhes do chamado (título, descrição, etc.) | Sim | — | Leitura completa |
| Aprovações (Encarregado/Supervisor/Gerente) | Sim | — | Visualização OK |
| Execuções de Manutenção | Sim | — | "Nenhuma execução registrada" |
| Chamados Vinculados | Sim | — | "Nenhum chamado vinculado" |
| Comentários existentes | Sim | — | 2 comentários visíveis |
| Campo de novo comentário | Sim | Sim | Pode adicionar comentários |
| Checkbox "Comentário interno" | Sim | Sim | Pode marcar como interno |
| **Card "Ações"** | **Sim (vazio)** | — | Card renderizado mas sem botões |
| Botão de Triagem | Não | — | `canTriage = false` |
| Botões de transição de status | Não | — | Nenhum (sem `tickets:execute` nem `tickets:approve`) |
| Botão Fechar (override) | Não | — | Não é Admin nem Gerente |
| Botão Excluir | Não | — | Não é Admin |

**Análise:** O Assistente tem acesso somente leitura, conforme esperado. O único ponto é que o card "Ações" aparece vazio (com título mas sem botões) ao invés de ser completamente ocultado — a lógica no código (linha 226 de `ticket-actions.tsx`) deveria retornar `null`, mas o card renderiza vazio na prática.

#### Lógica de Filtragem (por que nenhum botão aparece)

As transições permitidas para `awaiting_triage` são: `in_progress`, `technical_analysis`, `denied`.

| Transição | Permissão Requerida | Assistente tem? | Resultado |
|---|---|---|---|
| `in_progress` | `tickets:execute` | Não | Filtrado |
| `technical_analysis` | `tickets:execute` | Não | Filtrado |
| `denied` | `tickets:approve` | Não | Filtrado |

---

### 14.2 Teste: Cargo Comprador

| Campo | Valor |
|---|---|
| **Usuário** | Teste Comprador - Compras e Manutenção |
| **Email** | comprador_compras_e_manutencao_teste@garageinn.com |
| **Cargo** | Comprador |
| **Permissões** | `tickets:read`, `tickets:execute` |

**Status do chamado no momento do teste:** `awaiting_triage`

#### Resultado na Interface

| Elemento | Visível? | Habilitado? | Observação |
|---|---|---|---|
| Detalhes do chamado | Sim | — | Leitura completa |
| Aprovações | Sim | — | Todas aprovadas |
| Campo de novo comentário | Sim | Sim | Funcional |
| **Card "Ações"** | **Sim** | — | **Com 2 botões ativos** |
| **Botão "Iniciar Andamento"** | **Sim** | **Sim** | Transição `awaiting_triage → in_progress` |
| **Botão "Enviar para Análise Técnica"** | **Sim** | **Sim** | Transição `awaiting_triage → technical_analysis` |
| Botão "Negar" | Não | — | Requer `tickets:approve` |
| Botão de Triagem (formulário completo) | Não | — | `canTriage = false` |
| Botão Fechar (override) | Não | — | Não é Admin nem Gerente |
| Botão Excluir | Não | — | Não é Admin |

**Ação executada durante o teste:** O Comprador clicou em **"Iniciar Andamento"**, mudando o status para `in_progress`. Após a transição, os novos botões disponíveis passaram a ser os de `in_progress`:

| Botão | Transição | Permissão | Visível? |
|---|---|---|---|
| Enviar para Análise Técnica | `in_progress → technical_analysis` | `tickets:execute` | Sim |
| Iniciar Execução | `in_progress → executing` | `tickets:execute` | Sim |
| Cancelar | `in_progress → cancelled` | `tickets:execute` | Sim |
| Negar | `in_progress → denied` | `tickets:approve` | Não (filtrado) |

---

### 14.3 Comparativo de Cargos — Departamento Compras e Manutenção

| Capacidade | Assistente | Comprador | Gerente |
|---|---|---|---|
| **Permissões** | `tickets:read` | `tickets:read`, `tickets:execute` | `tickets:read`, `tickets:execute`, `tickets:approve`, `tickets:triage` |
| Visualizar chamado | Sim | Sim | Sim |
| Adicionar comentários | Sim | Sim | Sim |
| Iniciar andamento | **Não** | **Sim** | **Sim** |
| Enviar para análise técnica | **Não** | **Sim** | **Sim** |
| Iniciar execução | **Não** | **Sim** | **Sim** |
| Negar chamado | **Não** | **Não** | **Sim** |
| Fazer triagem (formulário) | **Não** | **Não** | **Sim** |
| Fechar chamado (override) | **Não** | **Não** | **Sim** |
| Criar chamado vinculado | **Não** | **Sim** (se `executing`/`waiting_parts`) | **Sim** (se `executing`/`waiting_parts`) |
| Excluir chamado | **Não** | **Não** | **Não** (apenas Admin) |

---

### 14.4 Fluxo de Status de Manutenção — Significado de Cada Etapa

| Status | Significado | Quem atua |
|---|---|---|
| `awaiting_triage` | Chamado aprovado, aguardando equipe de Manutenção assumir | Comprador/Gerente de Compras |
| `in_progress` | Equipe avaliando o chamado, decidindo próximos passos | Comprador/Gerente de Compras |
| `technical_analysis` | Requer análise técnica aprofundada antes de executar (ex: inspeção no local) | Comprador/Gerente de Compras |
| `awaiting_approval` | Análise concluída, aguardando aprovação para executar | Gerente de Compras |
| `approved` | Aprovado para execução | — |
| `executing` | Manutenção em andamento; pode gerar chamados vinculados (Compras/TI) | Comprador/Gerente de Compras |
| `waiting_parts` | Execução pausada aguardando peças/materiais; pode gerar chamados vinculados | Comprador/Gerente de Compras |
| `completed` | Manutenção concluída, aguardando avaliação do solicitante | Solicitante |
| `evaluating` | Solicitante avaliando o resultado | Solicitante |
| `closed` | Chamado encerrado | — |

---

## 15. Conclusões Gerais da Sessão de Testes

### O que funcionou corretamente

| # | Item | Status |
|---|---|---|
| 1 | Conexão MCP Supabase com o projeto GarageInn | OK |
| 2 | Consulta de dados do chamado #65 via SQL (detalhes, histórico, aprovações, comentários) | OK |
| 3 | Cadeia de aprovação hierárquica Encarregado → Supervisor → Gerente → Triagem | OK |
| 4 | RBAC do Assistente: somente leitura, sem botões de ação | OK |
| 5 | RBAC do Comprador: `tickets:execute` habilita botões operacionais | OK |
| 6 | Filtragem de botões por permissão (dupla validação server + client) | OK |
| 7 | Botão "Negar" corretamente oculto para quem não tem `tickets:approve` | OK |
| 8 | Transições de status consistentes com `constants.ts` | OK |
| 9 | Criação de chamado filho vinculado (Manutenção → Compras) | OK |
| 10 | Fluxo de cotações no chamado de compras | OK |

### Pontos de atenção identificados

| # | Item | Severidade | Descrição |
|---|---|---|---|
| 1 | **Card "Ações" vazio para Assistente** | Baixa | O card renderiza com título "Ações" mas sem botões. Deveria ser completamente ocultado (`return null`). Possível discrepância entre a lógica de `hasManageActions` e a renderização. |
| 2 | **Comprador pula triagem formal** | Média | O Comprador pode clicar "Iniciar Andamento" em `awaiting_triage` sem definir prioridade, responsável ou prazo. Isso bypassa a triagem formal que o Gerente faria. Pode ser intencional ou um gap. |
| 3 | **Aprovação pelo solicitante** | Média | Requisito diz que o solicitante deveria escolher a cotação. Implementação mantém tudo dentro de Compras. (Já documentado na seção 10.) |
| 4 | **Dados opcionais não preenchidos** | Baixa | Unidade, prioridade e responsável ficam `null` no chamado filho. Poderia herdar do pai. |

---

## 16. Dados Brutos das Consultas

### Ticket principal (tickets)
```json
{
  "id": "1c3c02b3-3ebc-4986-9bcd-a5d3dc3ab50c",
  "ticket_number": 66,
  "title": "Compra de camera",
  "description": "Precisa comprar uma camera nova",
  "status": "quoting",
  "priority": null,
  "perceived_urgency": null,
  "department_id": "1973b68b-eed0-440d-9ed3-036f26ebf6f4",
  "category_id": null,
  "unit_id": null,
  "created_by": "052892bf-4cab-4b25-9a4a-7afe23268e7a",
  "assigned_to": null,
  "due_date": null,
  "denial_reason": null,
  "resolved_at": null,
  "closed_at": null,
  "created_at": "2026-02-21T03:31:49.51435+00",
  "updated_at": "2026-02-21T03:32:47.491238+00",
  "parent_ticket_id": "3879088b-7aa6-4fc2-80ff-4e1ce55a6448",
  "origin_ticket_type": "manutencao"
}
```

### ticket_history (chamado #66)
```json
[
  {
    "action": "status_change",
    "old_value": "awaiting_triage",
    "new_value": "in_progress",
    "created_at": "2026-02-21T03:32:41.212932+00",
    "actor_name": "Teste Comprador - Compras e Manutenção"
  },
  {
    "action": "status_change",
    "old_value": "in_progress",
    "new_value": "quoting",
    "created_at": "2026-02-21T03:32:47.491238+00",
    "actor_name": "Teste Comprador - Compras e Manutenção"
  }
]
```

### ticket_quotations
```json
[
  {
    "id": "313b907f-a5fd-4d6c-a464-f71873ea90e3",
    "supplier_name": "empresa teste",
    "quantity": 1,
    "unit_price": "289.00",
    "total_price": "289.00",
    "delivery_deadline": "2026-02-23",
    "status": "pending",
    "is_selected": false,
    "created_at": "2026-02-21T03:33:19.595311+00"
  },
  {
    "id": "8dd1b850-6046-45ed-81d1-0b4de0856f74",
    "supplier_name": "Empresa teste 2",
    "quantity": 1,
    "unit_price": "295.00",
    "total_price": "295.00",
    "delivery_deadline": "2026-02-21",
    "status": "pending",
    "is_selected": false,
    "created_at": "2026-02-21T03:33:46.009263+00"
  }
]
```

### ticket_comments
```json
[
  {
    "id": "b4ac5892-b106-4add-97ef-743daece7737",
    "user_id": "052892bf-4cab-4b25-9a4a-7afe23268e7a",
    "content": "Comentário teste",
    "is_internal": false,
    "created_at": "2026-02-21T03:35:13.644723+00"
  }
]
```
