-- Add awaiting_requester_selection ticket status
alter table public.tickets
  drop constraint if exists tickets_status_check;

alter table public.tickets
  add constraint tickets_status_check
  check (
    status = any (
      array[
        'awaiting_approval_encarregado',
        'awaiting_approval_supervisor',
        'awaiting_approval_gerente',
        'awaiting_triage',
        'prioritized',
        'in_progress',
        'quoting',
        'awaiting_requester_selection',
        'awaiting_approval',
        'approved',
        'purchasing',
        'in_delivery',
        'delivered',
        'evaluating',
        'technical_analysis',
        'executing',
        'waiting_parts',
        'completed',
        'in_analysis',
        'in_investigation',
        'awaiting_customer',
        'awaiting_quotations',
        'in_repair',
        'awaiting_payment',
        'awaiting_return',
        'resolved',
        'closed',
        'denied',
        'cancelled'
      ]::text[]
    )
  );

-- Allow "interessado" (manager from requester department) to update quotations
drop policy if exists interessado_can_select_quotation on public.ticket_quotations;

create policy interessado_can_select_quotation
  on public.ticket_quotations
  for update
  to authenticated
  using (
    exists (
      select 1
      from tickets t
      join tickets pt on pt.id = t.parent_ticket_id
      join user_roles ur_creator on ur_creator.user_id = pt.created_by
      join roles r_creator on r_creator.id = ur_creator.role_id
      join user_roles ur_current on ur_current.user_id = auth.uid()
      join roles r_current on r_current.id = ur_current.role_id
      where t.id = ticket_quotations.ticket_id
        and t.status = 'awaiting_requester_selection'
        and r_current.department_id = r_creator.department_id
        and r_current.name = 'Gerente'
    )
  )
  with check (
    exists (
      select 1
      from tickets t
      join tickets pt on pt.id = t.parent_ticket_id
      join user_roles ur_creator on ur_creator.user_id = pt.created_by
      join roles r_creator on r_creator.id = ur_creator.role_id
      join user_roles ur_current on ur_current.user_id = auth.uid()
      join roles r_current on r_current.id = ur_current.role_id
      where t.id = ticket_quotations.ticket_id
        and t.status = 'awaiting_requester_selection'
        and r_current.department_id = r_creator.department_id
        and r_current.name = 'Gerente'
    )
  );
