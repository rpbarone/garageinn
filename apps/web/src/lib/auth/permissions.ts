/**
 * Sistema de Permissões GAPP
 *
 * Define as permissões disponíveis no sistema e a matriz de permissões
 * por cargo e departamento.
 *
 * IMPORTANTE: Os nomes de cargos e departamentos devem corresponder EXATAMENTE
 * aos valores cadastrados no banco de dados.
 */

/** Tipos de permissão disponíveis no sistema */
export type Permission =
  // Usuários
  | "users:read"
  | "users:create"
  | "users:update"
  | "users:delete"
  | "users:impersonate"
  // Unidades
  | "units:read"
  | "units:create"
  | "units:update"
  // Chamados
  | "tickets:read"
  | "tickets:create"
  | "tickets:triage"
  | "tickets:approve"
  | "tickets:execute"
  // Checklists
  | "checklists:read"
  | "checklists:execute"
  | "checklists:configure"
  // Supervisão
  | "supervision:read"
  // Configurações
  | "settings:read"
  | "settings:update"
  // Relatórios
  | "reports:read"
  // Admin total
  | "admin:all";

/** Cargos globais têm permissões expandidas (não pertencem a departamento específico) */
export const GLOBAL_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  Desenvolvedor: ["admin:all"],
  Diretor: ["admin:all"],
  Administrador: ["admin:all"],
};

/**
 * Permissões por cargo dentro de cada departamento
 *
 * IMPORTANTE: Os nomes devem corresponder EXATAMENTE ao banco de dados!
 *
 * Cargos por departamento (verificado em 17/01/2026):
 * - Operações: Manobrista, Encarregado, Supervisor, Gerente
 * - Compras e Manutenção: Assistente, Comprador, Gerente
 * - Financeiro: Auxiliar, Assistente, Analista Júnior, Analista Pleno, Analista Sênior, Supervisor, Gerente
 * - TI: Analista, Gerente
 * - RH: Auxiliar, Assistente, Analista Júnior, Analista Pleno, Analista Sênior, Supervisor, Gerente
 * - Comercial: Gerente
 * - Auditoria: Auditor, Gerente
 * - Sinistros: Supervisor, Gerente
 */
export const DEPARTMENT_ROLE_PERMISSIONS: Record<
  string,
  Record<string, Permission[]>
> = {
  // ===== OPERAÇÕES =====
  Operações: {
    Manobrista: [
      "tickets:read",
      "tickets:create",
      "checklists:read",
      "checklists:execute",
    ],
    Encarregado: [
      "tickets:read",
      "tickets:create",
      "tickets:approve",
      "checklists:read",
      "checklists:execute",
    ],
    Supervisor: [
      "tickets:read",
      "tickets:create",
      "tickets:approve",
      "checklists:read",
      "checklists:execute",
      "supervision:read",
      "units:read",
    ],
    Gerente: [
      "tickets:read",
      "tickets:create",
      "tickets:triage",
      "tickets:approve",
      "checklists:read",
      "checklists:execute",
      "checklists:configure",
      "supervision:read",
      "units:read",
      "units:update",
      "reports:read",
    ],
  },

  // ===== COMPRAS E MANUTENÇÃO =====
  // Cargos no banco: Assistente, Comprador, Gerente
  // TODO: configurar por nível conforme necessidade futura
  "Compras e Manutenção": {
    Assistente: ["tickets:read", "tickets:execute"],
    Comprador: ["tickets:read", "tickets:execute"],
    Gerente: [
      "tickets:read",
      "tickets:execute",
      "tickets:approve",
      "tickets:triage",
      "settings:read",
      "reports:read",
    ],
  },

  // ===== FINANCEIRO =====
  // Cargos no banco: Auxiliar, Assistente, Analista Júnior, Analista Pleno, Analista Sênior, Supervisor, Gerente
  Financeiro: {
    Auxiliar: ["tickets:read"],
    Assistente: ["tickets:read"],
    "Analista Júnior": ["tickets:read", "tickets:execute"],
    "Analista Pleno": ["tickets:read", "tickets:execute", "tickets:approve"],
    "Analista Sênior": ["tickets:read", "tickets:execute", "tickets:approve"],
    Supervisor: [
      "tickets:read",
      "tickets:execute",
      "tickets:approve",
      "tickets:triage",
      "reports:read",
    ],
    Gerente: [
      "tickets:read",
      "tickets:execute",
      "tickets:approve",
      "tickets:triage",
      "settings:read",
      "reports:read",
    ],
  },

  // ===== TI =====
  // Cargos no banco: Analista, Gerente
  // Nota: Desenvolvedor é cargo global (definido em GLOBAL_ROLE_PERMISSIONS)
  TI: {
    Analista: ["tickets:read", "tickets:execute", "settings:read", "reports:read"],
    // Importante: Gerente TI NÃO é admin global. Mantemos permissões mínimas
    // para executar o fluxo do chamado (Iniciar/Concluir) e acessar Configurações,
    // sem expor menus como Usuários/Unidades/Relatórios.
    Gerente: ["tickets:read", "tickets:execute", "settings:read"],
  },

  // ===== RH =====
  // Cargos no banco: Auxiliar, Assistente, Analista Júnior, Analista Pleno, Analista Sênior, Supervisor, Gerente
  RH: {
    Auxiliar: ["users:read"],
    Assistente: ["users:read"],
    "Analista Júnior": ["users:read", "users:create"],
    "Analista Pleno": ["users:read", "users:create", "users:update"],
    "Analista Sênior": ["users:read", "users:create", "users:update"],
    Supervisor: ["users:read", "users:create", "users:update", "users:delete"],
    Gerente: [
      "users:read",
      "users:create",
      "users:update",
      "users:delete",
      "settings:read",
      "reports:read",
    ],
  },

  // ===== COMERCIAL =====
  // Cargos no banco: Gerente
  Comercial: {
    Gerente: ["units:read", "tickets:read", "settings:read", "reports:read"],
  },

  // ===== AUDITORIA =====
  // Cargos no banco: Auditor, Gerente
  Auditoria: {
    Auditor: ["tickets:read", "checklists:read", "reports:read"],
    Gerente: [
      "tickets:read",
      "tickets:approve",
      "checklists:read",
      "checklists:configure",
      "settings:read",
      "reports:read",
    ],
  },

  // ===== SINISTROS =====
  // Cargos no banco: Supervisor, Gerente
  Sinistros: {
    Supervisor: ["tickets:read", "tickets:execute", "tickets:approve"],
    Gerente: [
      "tickets:read",
      "tickets:execute",
      "tickets:approve",
      "tickets:triage",
      "settings:read",
      "reports:read",
    ],
  },
};

/** Lista de todas as permissões do sistema (para validação) */
export const ALL_PERMISSIONS: Permission[] = [
  "users:read",
  "users:create",
  "users:update",
  "users:delete",
  "users:impersonate",
  "units:read",
  "units:create",
  "units:update",
  "tickets:read",
  "tickets:create",
  "tickets:triage",
  "tickets:approve",
  "tickets:execute",
  "checklists:read",
  "checklists:execute",
  "checklists:configure",
  "supervision:read",
  "settings:read",
  "settings:update",
  "reports:read",
  "admin:all",
];
